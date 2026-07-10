terraform {
  required_version = ">= 1.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---- Networking: use the account's default VPC ----
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ---- Latest Ubuntu 22.04 LTS AMI (Canonical) ----
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---- Security group ----
resource "aws_security_group" "quiz" {
  name_prefix = "${var.instance_name}-"
  description = "Team Quiz: SSH + HTTP/HTTPS"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_ingress_cidr]
  }
  ingress {
    description = "HTTP Lets Encrypt and redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.app_ingress_cidr]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.app_ingress_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---- Instance ----
resource "aws_instance" "quiz" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = element(tolist(data.aws_subnets.default.ids), 0)
  vpc_security_group_ids      = [aws_security_group.quiz.id]
  key_name                    = var.key_name
  associate_public_ip_address = true

  metadata_options {
    http_tokens = "optional" # allow IMDSv1+v2 (setup script uses v2 token anyway)
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = {
    Name = var.instance_name
  }

  lifecycle {
    ignore_changes = [ami]
  }
}
# ---- Stable public address ----
resource "aws_eip" "quiz" {
  domain = "vpc"
  tags   = { Name = var.instance_name }
}

resource "aws_eip_association" "quiz" {
  instance_id   = aws_instance.quiz.id
  allocation_id = aws_eip.quiz.id
}

# ---- Optional Route53 A record ----
resource "aws_route53_record" "quiz" {
  count   = var.route53_zone_id == "" ? 0 : 1
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 60
  records = [aws_eip.quiz.public_ip]
}

# ---- Deploy + configure the app ----
resource "null_resource" "deploy" {
  depends_on = [aws_eip_association.quiz]

  triggers = {
    instance_id = aws_instance.quiz.id
    setup_hash  = filemd5("${path.module}/setup.sh")
    # Hash the full deployed app so a change to any of server.js, store.js,
    # package*.json, src/, questions/ or public/ triggers a redeploy — not just
    # server.js. (fileset globs don't support brace {a,b} alternation, so we
    # concatenate one fileset per directory.)
    app_hash = sha1(join("", concat(
      [for f in ["server.js", "store.js", "package.json", "package-lock.json"] : filemd5("${path.module}/../${f}")],
      [for f in fileset("${path.module}/..", "src/**") : filemd5("${path.module}/../${f}")],
      [for f in fileset("${path.module}/..", "questions/**") : filemd5("${path.module}/../${f}")],
      [for f in fileset("${path.module}/..", "public/**") : filemd5("${path.module}/../${f}")]
    )))
  }

  # Build a clean tarball of just the app (no node_modules / infra / data)
  provisioner "local-exec" {
    command = "cd ${path.module}/.. && rm -f infra/app.tar.gz && tar -czf infra/app.tar.gz server.js store.js package.json package-lock.json src questions public README.md"
  }

  provisioner "file" {
    source      = "${path.module}/app.tar.gz"
    destination = "/tmp/app.tar.gz"
    connection {
      type        = "ssh"
      host        = aws_eip.quiz.public_ip
      user        = "ubuntu"
      private_key = file(var.ssh_private_key_path)
      timeout     = "5m"
    }
  }

  provisioner "file" {
    content = <<-EOT
      DOMAIN='${var.domain_name}'
      LE_EMAIL='${var.letsencrypt_email}'
      WIN_SCORE='${var.win_score}'
      SHARED_PASSWORD='${var.shared_password}'
      SUPER_ADMIN_USER='${var.super_admin_user}'
      SUPER_ADMIN_PASSWORD='${var.super_admin_password}'
      RUN_CERTBOT='${var.route53_zone_id == "" ? "no" : "yes"}'
    EOT
    destination = "/tmp/team-quiz.env"
    connection {
      type        = "ssh"
      host        = aws_eip.quiz.public_ip
      user        = "ubuntu"
      private_key = file(var.ssh_private_key_path)
      timeout     = "5m"
    }
  }

  provisioner "file" {
    source      = "${path.module}/setup.sh"
    destination = "/tmp/setup.sh"
    connection {
      type        = "ssh"
      host        = aws_eip.quiz.public_ip
      user        = "ubuntu"
      private_key = file(var.ssh_private_key_path)
      timeout     = "5m"
    }
  }

  provisioner "remote-exec" {
    inline = ["sudo bash /tmp/setup.sh /tmp/team-quiz.env"]
    connection {
      type        = "ssh"
      host        = aws_eip.quiz.public_ip
      user        = "ubuntu"
      private_key = file(var.ssh_private_key_path)
      timeout     = "10m"
    }
  }
}
