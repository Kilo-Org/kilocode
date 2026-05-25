terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ---------------------------------------------------------------------------
# Current public IP (used to restrict SSH ingress)
# ---------------------------------------------------------------------------

data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

locals {
  my_cidr = var.allowed_cidr != null ? var.allowed_cidr : "${chomp(data.http.my_ip.response_body)}/32"
}

# ---------------------------------------------------------------------------
# Latest Ubuntu 24.04 LTS amd64 AMI from Canonical
# ---------------------------------------------------------------------------

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

# ---------------------------------------------------------------------------
# Default VPC and subnet
# ---------------------------------------------------------------------------

data "aws_vpc" "default" {
  count   = var.vpc_id == null ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = var.subnet_id == null ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }

  filter {
    name   = "defaultForAz"
    values = ["true"]
  }
}

locals {
  vpc_id    = var.vpc_id != null ? var.vpc_id : data.aws_vpc.default[0].id
  subnet_id = var.subnet_id != null ? var.subnet_id : data.aws_subnets.default[0].ids[0]
}

# ---------------------------------------------------------------------------
# EC2 key pair
# ---------------------------------------------------------------------------

resource "aws_key_pair" "this" {
  key_name   = var.key_name
  public_key = file(pathexpand(var.public_key_path))

  tags = {
    Name = var.name
  }
}

# ---------------------------------------------------------------------------
# Security group — SSH only from current public IP
# ---------------------------------------------------------------------------

resource "aws_security_group" "this" {
  name        = var.name
  description = "SSH access for JetBrains remote development"
  vpc_id      = local.vpc_id

  ingress {
    description = "SSH from operator IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [local.my_cidr]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = var.name
  }
}

# ---------------------------------------------------------------------------
# EC2 instance
# ---------------------------------------------------------------------------

resource "aws_instance" "this" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = local.subnet_id
  key_name                    = aws_key_pair.this.key_name
  vpc_security_group_ids      = [aws_security_group.this.id]
  associate_public_ip_address = true

  user_data = file("${path.module}/cloud-init.sh")

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name = var.name
  }

  volume_tags = {
    Name = var.name
  }
}
