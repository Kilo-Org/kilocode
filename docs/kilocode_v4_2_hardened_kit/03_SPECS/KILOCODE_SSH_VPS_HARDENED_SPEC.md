# KiloCode SSH and VPS Hardened Spec

## Purpose
Bring remote systems into KiloCode as first-class managed surfaces.

## Data model
### SSHProfile
```yaml
name: string
host: string
port: integer
user: string
auth_mode: key|password
key_path: string|null
jump_host: string|null
labels: [string]
group: string
```

## Primary operations
- connect(profile_name)
- open_terminal(profile_name)
- list_remote_files(profile_name, remote_path)
- open_remote_file(profile_name, remote_path)
- save_remote_file(profile_name, remote_path, content)
- tail_logs(profile_name, service_name)
- restart_service(profile_name, service_name)

## Failure modes
- host unreachable
- authentication failure
- permission denied
- save conflict
- missing remote file
- service restart denied

## Evidence requirements
- connection transcript
- screenshot of remote tree
- diff before save
- log tail transcript
- approval record for service restart
