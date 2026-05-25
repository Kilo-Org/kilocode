# ec2-dev — Disposable JetBrains Dev Instance

Terraform configuration for a disposable AWS EC2 instance used with JetBrains Gateway remote development. The instance is meant to be terminated when not in use and recreated on demand to minimize cost.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured with credentials that have EC2 permissions
- An SSH key pair: a private key (`.pem`) and its matching public key (`.pub`)

If you only have a `.pem` private key, generate the public key first:

```bash
ssh-keygen -y -f ~/.ssh/your-key.pem > ~/.ssh/your-key.pub
```

## Setup

Copy the example vars file and fill in your values:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
public_key_path = "~/.ssh/your-key.pub"   # path to your SSH public key
key_name        = "your-name-dev"          # name to register in EC2
```

All other variables are optional — see [Variables](#variables) below.

Initialize Terraform (first time only, or after a provider version change):

```bash
terraform init
```

## Create an instance

```bash
terraform apply
```

After apply completes, connection details are printed automatically. Retrieve them any time with:

```bash
terraform output
```

Or get individual values:

```bash
terraform output -raw ssh_command
terraform output -raw public_ip
terraform output -raw jetbrains_gateway_host
```

The bootstrap script runs in the background on first boot. It installs Homebrew, `git`, and Java 21. Allow **3–5 minutes** before the first SSH connection.

Check bootstrap progress:

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@$(terraform output -raw public_ip) \
  'tail -f /var/log/kilo-jetbrains-bootstrap.log'
```

## Connect

### SSH

```bash
eval "$(terraform output -raw ssh_command)"
```

### JetBrains Gateway

1. Open JetBrains Gateway → **Connect via SSH**.
2. Host: `terraform output -raw jetbrains_gateway_host`
3. Port: `22`
4. Username: `ubuntu`
5. Private key: path to your `.pem` file.

## Destroy (when done)

This permanently deletes the instance and its root volume. All data on the instance will be lost.

```bash
terraform destroy
```

## Recreate

After destroying, run `terraform apply` again to get a fresh instance. The same `terraform.tfvars` values are reused.

## Refresh SSH access after an IP change

If your local public IP changes (e.g. after switching networks or restarting your router), re-apply to update the security group rule:

```bash
terraform apply
```

Terraform detects your new IP from `checkip.amazonaws.com` and updates the ingress rule in place without recreating the instance.

## Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `public_key_path` | — | yes | Path to SSH public key file (`.pub`) |
| `key_name` | — | yes | EC2 key pair name to register in AWS |
| `region` | `us-west-2` | no | AWS region |
| `name` | `jetbrains-dev` | no | Name tag applied to all resources |
| `instance_type` | `m7i.xlarge` | no | EC2 instance type (4 vCPU, 16 GiB) |
| `root_volume_size` | `100` | no | Root EBS volume size in GiB |
| `allowed_cidr` | auto-detect | no | SSH ingress CIDR; defaults to current public IP `/32` |
| `subnet_id` | auto-detect | no | Subnet to launch into; defaults to first default subnet |
| `vpc_id` | auto-detect | no | VPC for the security group; defaults to default VPC |

## Outputs

| Output | Description |
|---|---|
| `instance_id` | EC2 instance ID |
| `public_ip` | Public IP address |
| `public_dns` | Public DNS hostname |
| `ssh_user` | SSH username (`ubuntu`) |
| `ssh_command` | Full `ssh` command to connect |
| `jetbrains_gateway_host` | Host to enter in JetBrains Gateway |
| `security_group_id` | Security group ID |
| `region` | AWS region |
| `allowed_cidr` | CIDR currently allowed for SSH |

## Pre-installed software

The cloud-init bootstrap installs:

- System packages: `build-essential`, `curl`, `file`, `git`, `ca-certificates`, `unzip`, `zip`, `tar`, `gzip`
- [Homebrew](https://brew.sh) (Linuxbrew)
- `brew git`
- `brew openjdk@21` with `JAVA_HOME` configured in `~/.bashrc`

## Instance details

| Property | Value |
|---|---|
| OS | Ubuntu 24.04 LTS amd64 (latest Canonical AMI) |
| Instance type | `m7i.xlarge` by default |
| Root volume | 100 GiB gp3, encrypted, deleted on termination |
| SSH user | `ubuntu` |
| Inbound access | SSH only, from your current public IP |
| Elastic IP | None (IP changes on recreate) |
| Terraform state | Local only (`terraform.tfstate`) |

## Files

| File | Purpose |
|---|---|
| `main.tf` | AWS resources: EC2, security group, key pair, AMI/VPC/subnet lookups |
| `variables.tf` | Input variable declarations |
| `outputs.tf` | Connection info outputs |
| `cloud-init.sh` | First-boot bootstrap script |
| `terraform.tfvars.example` | Template for local variable overrides |
| `.gitignore` | Excludes state, `.tfvars`, and provider cache from version control |
| `.terraform.lock.hcl` | Provider version lock (committed for reproducibility) |

## Cost notes

- `m7i.xlarge` in `us-west-2` costs roughly **$0.20/hour** while running.
- The root EBS volume (100 GiB gp3) costs roughly **$8/month** while it exists.
- After `terraform destroy` there are **no ongoing charges** — instance and volume are deleted.
- There is no Elastic IP, so there is no idle IP allocation charge.
