variable "region" {
  description = "AWS region to create the instance in."
  type        = string
  default     = "us-west-2"
}

variable "name" {
  description = "Name prefix applied to all resources."
  type        = string
  default     = "jetbrains-dev"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "m7i.xlarge"
}

variable "public_key_path" {
  description = "Path to the SSH public key file (.pub) to import as an EC2 key pair."
  type        = string
  # No default — must be supplied via terraform.tfvars or TF_VAR_public_key_path.
}

variable "key_name" {
  description = "Name to register the EC2 key pair under in AWS."
  type        = string
  # No default — must be supplied via terraform.tfvars or TF_VAR_key_name.
}

variable "root_volume_size" {
  description = "Size of the root EBS volume in GiB."
  type        = number
  default     = 100
}

variable "allowed_cidr" {
  description = "CIDR allowed to reach SSH. null = auto-detect current public IP."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID to launch the instance into. null = use first default subnet in the region."
  type        = string
  default     = null
}

variable "vpc_id" {
  description = "VPC ID for the security group. null = use the default VPC."
  type        = string
  default     = null
}
