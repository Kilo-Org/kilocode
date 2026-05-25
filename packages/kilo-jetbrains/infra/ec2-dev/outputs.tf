output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.this.id
}

output "public_ip" {
  description = "Public IP address of the instance."
  value       = aws_instance.this.public_ip
}

output "public_dns" {
  description = "Public DNS hostname of the instance."
  value       = aws_instance.this.public_dns
}

output "ssh_user" {
  description = "SSH username."
  value       = "ubuntu"
}

output "ssh_command" {
  description = "Full SSH command to connect to the instance."
  value       = "ssh -i ${pathexpand(var.public_key_path) == var.public_key_path ? replace(var.public_key_path, ".pub", "") : replace(pathexpand(var.public_key_path), ".pub", "")} ubuntu@${aws_instance.this.public_ip}"
}

output "jetbrains_gateway_host" {
  description = "Host value to enter in JetBrains Gateway SSH connection."
  value       = aws_instance.this.public_ip
}

output "security_group_id" {
  description = "Security group ID managing SSH ingress."
  value       = aws_security_group.this.id
}

output "region" {
  description = "AWS region the instance was created in."
  value       = var.region
}

output "allowed_cidr" {
  description = "CIDR currently allowed for SSH ingress."
  value       = local.my_cidr
}
