use anyhow::{bail, Context, Result};
use base64::Engine;
use serde::Deserialize;
use std::ffi::OsString;
use std::path::PathBuf;

#[cfg(windows)]
mod windows;

const PROFILE_ENV: &str = "KILO_SANDBOX_PROFILE";
const PARENT_ENV: &str = "KILO_SANDBOX_PARENT_PID";
const PROTOCOL: u32 = 1;

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathRule {
    path: PathBuf,
    kind: PathKind,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PathKind {
    Literal,
    Subtree,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Filesystem {
    allow_write: Vec<PathRule>,
    deny_write: Vec<PathRule>,
    deny_names: Vec<String>,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Deserialize)]
struct Request {
    version: u32,
    filesystem: Filesystem,
}

fn request() -> Result<Request> {
    let encoded = std::env::var(PROFILE_ENV).context("missing sandbox profile")?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .context("invalid sandbox profile encoding")?;
    let request: Request = serde_json::from_slice(&data).context("invalid sandbox profile")?;
    if request.version != PROTOCOL {
        bail!(
            "unsupported sandbox helper protocol {}, expected {}",
            request.version,
            PROTOCOL
        );
    }
    Ok(request)
}

fn target() -> Result<(OsString, Vec<OsString>)> {
    let mut args = std::env::args_os().skip(1);
    let Some(marker) = args.next() else {
        bail!("missing command separator");
    };
    if marker != "--" {
        bail!("invalid command separator");
    }
    let Some(command) = args.next() else {
        bail!("missing target command");
    };
    Ok((command, args.collect()))
}

fn run() -> Result<i32> {
    let request = request()?;
    let (command, args) = target()?;
    let parent = std::env::var(PARENT_ENV)
        .ok()
        .and_then(|value| value.parse::<u32>().ok());

    #[cfg(windows)]
    {
        windows::run(request.filesystem, command, args, parent)
    }

    #[cfg(not(windows))]
    {
        let _ = (request, command, args, parent);
        bail!("the Windows sandbox helper only runs on Windows")
    }
}

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("kilo Windows sandbox: {error:#}");
            std::process::exit(126);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_protocol_profile() {
        let value = serde_json::json!({
            "version": 1,
            "filesystem": {
                "allowWrite": [{ "path": "C:\\work", "kind": "subtree" }],
                "denyWrite": [],
                "denyNames": [".git"]
            }
        });
        let request: Request = serde_json::from_value(value).expect("profile");
        assert_eq!(request.version, PROTOCOL);
        assert_eq!(request.filesystem.allow_write.len(), 1);
        assert_eq!(request.filesystem.allow_write[0].kind, PathKind::Subtree);
        assert_eq!(request.filesystem.deny_names, vec![".git"]);
    }
}
