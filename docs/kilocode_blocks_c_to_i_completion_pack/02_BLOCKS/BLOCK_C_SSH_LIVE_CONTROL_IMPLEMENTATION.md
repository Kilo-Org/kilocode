# Block C — SSH Live Control

Implement:
- strict SSHProfile type
- validation for host, port, auth mode, key path
- saved profiles
- connection test
- jump host support
- terminal sessions + reconnect
- SFTP tree browser
- remote open/edit/save
- diff-before-save
- transcript/log capture
- explicit failure handling

Required evidence:
- successful connection
- browse remote files
- edit + diff + save
- log tail
- failure paths: bad key, host down, permission denied
