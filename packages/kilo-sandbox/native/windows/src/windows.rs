use super::{Filesystem, PathKind, PathRule, PARENT_ENV, PROFILE_ENV};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::{c_void, OsStr, OsString};
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
    HLOCAL, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetSecurityInfo, SetEntriesInAclW, SetSecurityInfo, EXPLICIT_ACCESS_W,
    TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AclSizeInformation, CopySid, CreateRestrictedToken, EqualSid, GetAce, GetAclInformation,
    GetLengthSid, GetTokenInformation, SetTokenInformation, TokenDefaultDacl, TokenUser,
    ACCESS_ALLOWED_ACE, ACCESS_DENIED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
    DACL_SECURITY_INFORMATION, SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW, SearchPathW, DELETE,
    FILE_APPEND_DATA, FILE_ATTRIBUTE_REPARSE_POINT, FILE_DELETE_CHILD, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA,
    FILE_WRITE_EA, OPEN_EXISTING,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, DeleteProcThreadAttributeList, GetCurrentProcess, GetExitCodeProcess,
    InitializeProcThreadAttributeList, OpenProcess, OpenProcessToken, ResumeThread,
    UpdateProcThreadAttribute, WaitForMultipleObjects, WaitForSingleObject, CREATE_NO_WINDOW,
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
    PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

const READ_CONTROL: u32 = 0x0002_0000;
const WRITE_DAC: u32 = 0x0004_0000;
const WRITE_OWNER: u32 = 0x0008_0000;
const SE_FILE_OBJECT: i32 = 1;
const SET_ACCESS: i32 = 2;
const DENY_ACCESS: i32 = 3;
const GRANT_ACCESS: i32 = 1;
const OBJECT_INHERIT_ACE: u32 = 0x01;
const CONTAINER_INHERIT_ACE: u32 = 0x02;
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const FILE_PERSISTENT_ACLS: u32 = 0x0000_0008;
const DRIVE_FIXED: u32 = 3;
const DISABLE_MAX_PRIVILEGE: u32 = 0x01;
const LUA_TOKEN: u32 = 0x04;
const WRITE_RESTRICTED: u32 = 0x08;
const GENERIC_ALL: u32 = 0x1000_0000;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const HELPER: &str = "KILO_WINDOWS_SANDBOX_HELPER";
const SYNCHRONIZE: u32 = 0x0010_0000;

const ALLOW_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
const DENY_MASK: u32 = FILE_GENERIC_WRITE
    | FILE_WRITE_DATA
    | FILE_APPEND_DATA
    | FILE_WRITE_EA
    | FILE_WRITE_ATTRIBUTES
    | DELETE
    | FILE_DELETE_CHILD
    | WRITE_DAC
    | WRITE_OWNER;

struct Handle(HANDLE);

impl Handle {
    fn new(handle: HANDLE, action: &str) -> Result<Self> {
        if handle == 0 || handle == INVALID_HANDLE_VALUE {
            bail!("{action} failed: {}", unsafe { GetLastError() });
        }
        Ok(Self(handle))
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        if self.0 != 0 && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

struct Sid(*mut c_void);

impl Sid {
    fn parse(value: &str) -> Result<Self> {
        let value = wide(value);
        let mut sid = null_mut();
        let ok = unsafe { ConvertStringSidToSidW(value.as_ptr(), &mut sid) };
        if ok == 0 || sid.is_null() {
            bail!("could not create sandbox SID: {}", unsafe {
                GetLastError()
            });
        }
        Ok(Self(sid))
    }
}

impl Drop for Sid {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0 as HLOCAL);
            }
        }
    }
}

struct Root {
    path: PathBuf,
    kind: PathKind,
    sid: Sid,
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value
        .as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    let value = value.strip_prefix(r"\\?\").unwrap_or(&value);
    value.trim_end_matches('\\').to_lowercase()
}

fn contains(root: &Path, target: &Path) -> bool {
    let root = key(root);
    let target = key(target);
    target == root
        || target
            .strip_prefix(&root)
            .is_some_and(|rest| rest.starts_with('\\'))
}

fn volume(path: &Path) -> Result<()> {
    let path = wide(path.as_os_str());
    let mut root = vec![0u16; 32_768];
    let ok = unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) };
    if ok == 0 {
        bail!("could not resolve sandbox volume: {}", unsafe {
            GetLastError()
        });
    }
    let end = root
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(root.len());
    root.truncate(end + 1);
    let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
    if kind != DRIVE_FIXED {
        bail!("sandbox writable roots must be on a local fixed volume");
    }

    let mut flags = 0u32;
    let mut name = vec![0u16; 64];
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            &mut flags,
            name.as_mut_ptr(),
            name.len() as u32,
        )
    };
    if ok == 0 {
        bail!("could not inspect sandbox filesystem: {}", unsafe {
            GetLastError()
        });
    }
    let end = name
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(name.len());
    let name = String::from_utf16_lossy(&name[..end]);
    if !name.eq_ignore_ascii_case("NTFS") || flags & FILE_PERSISTENT_ACLS == 0 {
        bail!("sandbox writable roots require local NTFS with persistent ACLs");
    }

    let root = PathBuf::from(OsString::from_wide(&root[..root.len() - 1]));
    let root = key(&root);
    let path = key(Path::new(&OsString::from_wide(&path[..path.len() - 1])));
    if path == root {
        bail!("volume roots cannot be sandbox writable roots");
    }
    Ok(())
}

fn canonical(rule: &PathRule) -> Result<PathBuf> {
    let path = std::fs::canonicalize(&rule.path)
        .with_context(|| format!("sandbox path does not exist: {}", rule.path.display()))?;
    let meta = std::fs::symlink_metadata(&path)
        .with_context(|| format!("could not inspect sandbox path: {}", path.display()))?;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!(
            "sandbox writable roots cannot be reparse points: {}",
            path.display()
        );
    }
    match rule.kind {
        PathKind::Subtree if !meta.is_dir() => {
            bail!(
                "sandbox subtree root is not a directory: {}",
                path.display()
            )
        }
        PathKind::Literal if meta.is_dir() => {
            bail!(
                "literal writable directories are not supported: {}",
                path.display()
            )
        }
        _ => {}
    }
    volume(&path)?;
    Ok(path)
}

fn user(token: HANDLE) -> Result<Vec<u8>> {
    let mut size = 0u32;
    unsafe {
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut size);
    }
    if size == 0 {
        bail!("could not size the current user SID: {}", unsafe {
            GetLastError()
        });
    }
    let mut buffer = vec![0u8; size as usize];
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            size,
            &mut size,
        )
    };
    if ok == 0 {
        bail!("could not read the current user SID: {}", unsafe {
            GetLastError()
        });
    }
    let value = unsafe { std::ptr::read_unaligned(buffer.as_ptr() as *const TOKEN_USER) };
    let size = unsafe { GetLengthSid(value.User.Sid) };
    if size == 0 {
        bail!("could not read the current user SID length");
    }
    let mut sid = vec![0u8; size as usize];
    let ok = unsafe { CopySid(size, sid.as_mut_ptr() as *mut c_void, value.User.Sid) };
    if ok == 0 {
        bail!("could not copy the current user SID: {}", unsafe {
            GetLastError()
        });
    }
    Ok(sid)
}

fn sid(path: &Path, user: &[u8]) -> Result<Sid> {
    let mut hash = Sha256::new();
    hash.update(b"kilo-windows-sandbox-v1\0");
    hash.update(user);
    hash.update(b"\0");
    hash.update(key(path).as_bytes());
    let hash = hash.finalize();
    let part = |index: usize| {
        let value = u32::from_le_bytes(hash[index..index + 4].try_into().expect("hash part"));
        if value == 0 {
            1
        } else {
            value
        }
    };
    Sid::parse(&format!(
        "S-1-5-21-{}-{}-{}-{}",
        part(0),
        part(4),
        part(8),
        part(12)
    ))
}

unsafe fn has(dacl: *mut ACL, sid: *mut c_void, kind: u8, mask: u32, inherit: u32) -> bool {
    if dacl.is_null() {
        return false;
    }
    let mut info: ACL_SIZE_INFORMATION = zeroed();
    if GetAclInformation(
        dacl as *const ACL,
        &mut info as *mut _ as *mut c_void,
        size_of::<ACL_SIZE_INFORMATION>() as u32,
        AclSizeInformation,
    ) == 0
    {
        return false;
    }
    for index in 0..info.AceCount {
        let mut raw = null_mut();
        if GetAce(dacl as *const ACL, index, &mut raw) == 0 {
            continue;
        }
        let header = &*(raw as *const ACE_HEADER);
        if header.AceType != kind || u32::from(header.AceFlags) & inherit != inherit {
            continue;
        }
        let (found, access) = if kind == ACCESS_ALLOWED_ACE_TYPE {
            let ace = &*(raw as *const ACCESS_ALLOWED_ACE);
            (&ace.SidStart as *const u32 as *mut c_void, ace.Mask)
        } else {
            let ace = &*(raw as *const ACCESS_DENIED_ACE);
            (&ace.SidStart as *const u32 as *mut c_void, ace.Mask)
        };
        if EqualSid(found, sid) != 0 && access & mask == mask {
            return true;
        }
    }
    false
}

fn ace(path: &Path, sid: &Sid, mask: u32, mode: i32, inherit: u32) -> Result<()> {
    let path = wide(path.as_os_str());
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            0,
        )
    };
    let handle = Handle::new(handle, "opening sandbox ACL target")?;
    let mut dacl = null_mut();
    let mut descriptor = null_mut();
    let code = unsafe {
        GetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if code != 0 {
        bail!("reading sandbox ACL failed: {code}");
    }

    let kind = if mode == DENY_ACCESS {
        ACCESS_DENIED_ACE_TYPE
    } else {
        ACCESS_ALLOWED_ACE_TYPE
    };
    if unsafe { has(dacl, sid.0, kind, mask, inherit) } {
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        return Ok(());
    }

    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: mode,
        grfInheritance: inherit,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.0 as *mut u16,
        },
    };
    let mut next = null_mut();
    let code = unsafe { SetEntriesInAclW(1, &entry, dacl, &mut next) };
    if code != 0 {
        if !descriptor.is_null() {
            unsafe { LocalFree(descriptor as HLOCAL) };
        }
        bail!("building sandbox ACL failed: {code}");
    }
    let code = unsafe {
        SetSecurityInfo(
            handle.0,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            next,
            null_mut(),
        )
    };
    if !next.is_null() {
        unsafe { LocalFree(next as HLOCAL) };
    }
    if !descriptor.is_null() {
        unsafe { LocalFree(descriptor as HLOCAL) };
    }
    if code != 0 {
        bail!("applying sandbox ACL failed: {code}");
    }
    Ok(())
}

fn names(root: &Root, names: &[String]) -> Result<Vec<PathBuf>> {
    let names: HashSet<String> = names.iter().map(|name| name.to_lowercase()).collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    if names.contains(
        &root
            .path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
    ) {
        return Ok(vec![root.path.clone()]);
    }
    if root.kind == PathKind::Literal {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    let mut stack = vec![root.path.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)
            .with_context(|| format!("could not scan denied names under {}", dir.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let meta = std::fs::symlink_metadata(&path)?;
            if names.contains(&name) {
                found.push(path);
                continue;
            }
            if meta.is_dir() && meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
                stack.push(path);
            }
        }
    }
    Ok(found)
}

fn roots(fs: &Filesystem, user: &[u8]) -> Result<Vec<Root>> {
    let mut seen = HashSet::new();
    let mut roots = Vec::new();
    for rule in &fs.allow_write {
        let path = canonical(rule)?;
        if !seen.insert((key(&path), rule.kind as u8)) {
            continue;
        }
        let sid = sid(&path, user)?;
        let inherit = if rule.kind == PathKind::Subtree {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            0
        };
        ace(&path, &sid, ALLOW_MASK, SET_ACCESS, inherit)?;
        roots.push(Root {
            path,
            kind: rule.kind,
            sid,
        });
    }
    if roots.is_empty() {
        bail!("sandbox profile has no writable roots");
    }

    for rule in &fs.deny_write {
        let path = canonical(rule)?;
        let inherit = if rule.kind == PathKind::Subtree {
            OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
        } else {
            0
        };
        for root in &roots {
            if contains(&root.path, &path) {
                ace(&path, &root.sid, DENY_MASK, DENY_ACCESS, inherit)?;
            }
        }
    }
    for root in &roots {
        for path in names(root, &fs.deny_names)? {
            let meta = std::fs::symlink_metadata(&path)?;
            let inherit = if meta.is_dir() {
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
            } else {
                0
            };
            ace(&path, &root.sid, DENY_MASK, DENY_ACCESS, inherit)?;
        }
    }
    Ok(roots)
}

fn dacl(token: HANDLE, user: &mut [u8], roots: &[Root]) -> Result<()> {
    let mut entries = Vec::with_capacity(roots.len() + 1);
    let mut add = |sid: *mut c_void| {
        entries.push(EXPLICIT_ACCESS_W {
            grfAccessPermissions: GENERIC_ALL,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: 0,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: 0,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: sid as *mut u16,
            },
        });
    };
    add(user.as_mut_ptr() as *mut c_void);
    for root in roots {
        add(root.sid.0);
    }
    let mut acl = null_mut();
    let code =
        unsafe { SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), null_mut(), &mut acl) };
    if code != 0 {
        bail!("building sandbox token DACL failed: {code}");
    }
    let mut info = TOKEN_DEFAULT_DACL { DefaultDacl: acl };
    let ok = unsafe {
        SetTokenInformation(
            token,
            TokenDefaultDacl,
            &mut info as *mut _ as *mut c_void,
            size_of::<TOKEN_DEFAULT_DACL>() as u32,
        )
    };
    if !acl.is_null() {
        unsafe { LocalFree(acl as HLOCAL) };
    }
    if ok == 0 {
        bail!("setting sandbox token DACL failed: {}", unsafe {
            GetLastError()
        });
    }
    Ok(())
}

fn token(base: HANDLE, user: &mut [u8], roots: &[Root]) -> Result<Handle> {
    let mut sids: Vec<SID_AND_ATTRIBUTES> = roots
        .iter()
        .map(|root| SID_AND_ATTRIBUTES {
            Sid: root.sid.0,
            Attributes: 0,
        })
        .collect();
    let mut token = 0;
    let ok = unsafe {
        CreateRestrictedToken(
            base,
            DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED,
            0,
            null(),
            0,
            null(),
            sids.len() as u32,
            sids.as_mut_ptr(),
            &mut token,
        )
    };
    if ok == 0 {
        bail!("creating restricted token failed: {}", unsafe {
            GetLastError()
        });
    }
    let token = Handle::new(token, "creating restricted token")?;
    dacl(token.0, user, roots)?;
    Ok(token)
}

fn resolve(command: &OsStr) -> Result<PathBuf> {
    let path = Path::new(command);
    if path.is_absolute() || path.components().count() > 1 {
        return std::fs::canonicalize(path)
            .with_context(|| format!("target executable does not exist: {}", path.display()));
    }
    let command = wide(command);
    let value = OsString::from_wide(&command[..command.len() - 1]);
    let extension = if Path::new(&value).extension().is_some() {
        Vec::new()
    } else {
        wide(".exe")
    };
    let extension = if extension.is_empty() {
        null()
    } else {
        extension.as_ptr()
    };
    let mut buffer = vec![0u16; 32_768];
    let size = unsafe {
        SearchPathW(
            null(),
            command.as_ptr(),
            extension,
            buffer.len() as u32,
            buffer.as_mut_ptr(),
            null_mut(),
        )
    };
    if size == 0 || size as usize >= buffer.len() {
        bail!("could not resolve target executable: {}", unsafe {
            GetLastError()
        });
    }
    buffer.truncate(size as usize);
    Ok(PathBuf::from(OsString::from_wide(&buffer)))
}

fn quote(value: &OsStr) -> Vec<u16> {
    let value: Vec<u16> = value.encode_wide().collect();
    let needed = value.is_empty()
        || value
            .iter()
            .any(|value| matches!(*value, 0x20 | 0x09 | 0x0a | 0x0b | 0x22));
    if !needed {
        return value;
    }
    let mut out = vec![u16::from(b'"')];
    let mut slash = 0usize;
    for value in value {
        if value == u16::from(b'\\') {
            slash += 1;
            continue;
        }
        if value == u16::from(b'"') {
            out.extend(std::iter::repeat_n(u16::from(b'\\'), slash * 2 + 1));
            out.push(value);
            slash = 0;
            continue;
        }
        out.extend(std::iter::repeat_n(u16::from(b'\\'), slash));
        slash = 0;
        out.push(value);
    }
    out.extend(std::iter::repeat_n(u16::from(b'\\'), slash * 2));
    out.push(u16::from(b'"'));
    out
}

fn commandline(exe: &Path, args: &[OsString]) -> Vec<u16> {
    let mut line = quote(exe.as_os_str());
    for arg in args {
        line.push(u16::from(b' '));
        line.extend(quote(arg));
    }
    line.push(0);
    line
}

fn environment() -> Vec<u16> {
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(name, _)| {
            let name = name.to_string_lossy();
            !name.eq_ignore_ascii_case(PROFILE_ENV)
                && !name.eq_ignore_ascii_case(PARENT_ENV)
                && !name.eq_ignore_ascii_case(HELPER)
        })
        .collect();
    vars.sort_by(|left, right| {
        left.0
            .to_string_lossy()
            .to_lowercase()
            .cmp(&right.0.to_string_lossy().to_lowercase())
    });
    let mut block = Vec::new();
    for (name, value) in vars {
        block.extend(name.encode_wide());
        block.push(u16::from(b'='));
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

fn job() -> Result<Handle> {
    let job = unsafe { CreateJobObjectW(null(), null()) };
    let job = Handle::new(job, "creating sandbox Job Object")?;
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    info.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    let ok = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        bail!("configuring sandbox Job Object failed: {}", unsafe {
            GetLastError()
        });
    }
    Ok(job)
}

fn launch(
    token: &Handle,
    command: OsString,
    args: Vec<OsString>,
    parent: Option<u32>,
) -> Result<i32> {
    let exe = resolve(&command)?;
    let app = wide(exe.as_os_str());
    let mut line = commandline(&exe, &args);
    let mut env = environment();
    let cwd = std::env::current_dir().context("could not resolve target working directory")?;
    let cwd = wide(cwd.as_os_str());

    let stdin = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    let stdout = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    let stderr = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    let handles = [stdin, stdout, stderr];
    for handle in handles {
        if handle == 0 || handle == INVALID_HANDLE_VALUE {
            bail!("sandbox helper requires valid standard handles");
        }
        let ok = unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
        if ok == 0 {
            bail!("preparing inherited standard handle failed: {}", unsafe {
                GetLastError()
            });
        }
    }

    let mut size = 0usize;
    unsafe {
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
    }
    if size == 0 {
        bail!("could not size process attribute list: {}", unsafe {
            GetLastError()
        });
    }
    let mut storage = vec![0u8; size];
    let list = storage.as_mut_ptr() as *mut _;
    let ok = unsafe { InitializeProcThreadAttributeList(list, 1, 0, &mut size) };
    if ok == 0 {
        bail!("could not initialize process attribute list: {}", unsafe {
            GetLastError()
        });
    }
    let ok = unsafe {
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handles.as_ptr() as *mut c_void,
            size_of::<[HANDLE; 3]>(),
            null_mut(),
            null_mut(),
        )
    };
    if ok == 0 {
        unsafe { DeleteProcThreadAttributeList(list) };
        bail!("could not restrict inherited handles: {}", unsafe {
            GetLastError()
        });
    }

    let job = job()?;
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin;
    startup.StartupInfo.hStdOutput = stdout;
    startup.StartupInfo.hStdError = stderr;
    startup.lpAttributeList = list;
    let mut process: PROCESS_INFORMATION = unsafe { zeroed() };
    let ok = unsafe {
        CreateProcessAsUserW(
            token.0,
            app.as_ptr(),
            line.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT
                | CREATE_NO_WINDOW
                | EXTENDED_STARTUPINFO_PRESENT,
            env.as_mut_ptr() as *const c_void,
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut process,
        )
    };
    unsafe { DeleteProcThreadAttributeList(list) };
    if ok == 0 {
        bail!("launching restricted process failed: {}", unsafe {
            GetLastError()
        });
    }
    let process_handle = process.hProcess;
    let thread_handle = process.hThread;
    let process = Handle::new(process_handle, "launching restricted process")?;
    let thread = Handle::new(thread_handle, "launching restricted thread")?;
    let ok = unsafe { AssignProcessToJobObject(job.0, process.0) };
    if ok == 0 {
        bail!(
            "assigning restricted process to Job Object failed: {}",
            unsafe { GetLastError() }
        );
    }
    if unsafe { ResumeThread(thread.0) } == u32::MAX {
        bail!("resuming restricted process failed: {}", unsafe {
            GetLastError()
        });
    }
    drop(thread);

    let parent = parent
        .map(|pid| unsafe { OpenProcess(SYNCHRONIZE, 0, pid) })
        .filter(|handle| *handle != 0)
        .map(Handle);
    if let Some(parent) = parent.as_ref() {
        let handles = [process.0, parent.0];
        let wait =
            unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
        if wait == WAIT_FAILED {
            bail!("waiting for restricted process failed: {}", unsafe {
                GetLastError()
            });
        }
        if wait == WAIT_OBJECT_0 + 1 {
            unsafe {
                TerminateJobObject(job.0, 125);
                WaitForSingleObject(process.0, INFINITE);
            }
        }
    } else {
        let wait = unsafe { WaitForSingleObject(process.0, INFINITE) };
        if wait == WAIT_FAILED {
            bail!("waiting for restricted process failed: {}", unsafe {
                GetLastError()
            });
        }
    }

    let mut code = 126u32;
    let ok = unsafe { GetExitCodeProcess(process.0, &mut code) };
    if ok == 0 {
        bail!("reading restricted process exit code failed: {}", unsafe {
            GetLastError()
        });
    }
    Ok(code as i32)
}

pub(super) fn run(
    fs: Filesystem,
    command: OsString,
    args: Vec<OsString>,
    parent: Option<u32>,
) -> Result<i32> {
    let mut base = 0;
    let ok = unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
            &mut base,
        )
    };
    if ok == 0 {
        bail!("opening current process token failed: {}", unsafe {
            GetLastError()
        });
    }
    let base = Handle::new(base, "opening current process token")?;
    let mut user = user(base.0)?;
    let roots = roots(&fs, &user)?;
    let token = token(base.0, &mut user, &roots)?;
    launch(&token, command, args, parent)
}
