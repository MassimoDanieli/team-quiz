variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2" # London
}

variable "instance_name" {
  description = "Name tag for the instance and related resources"
  type        = string
  default     = "team-quiz"
}

variable "instance_type" {
  description = "EC2 instance type (t3.micro is plenty for ~8 players)"
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "Name of an existing EC2 key pair to attach to the instance"
  type        = string
}

variable "ssh_private_key_path" {
  description = "Local path to the private key matching key_name (used to deploy)"
  type        = string
}

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to SSH (set to YOUR.IP/32). Defaults to anywhere."
  type        = string
  default     = "0.0.0.0/0"
}

variable "app_ingress_cidr" {
  description = "CIDR allowed to reach HTTP/HTTPS. Keep 0.0.0.0/0 for a public domain, or restrict to an office/VPN range."
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain_name" {
  description = "Fully-qualified domain the quiz will be served on (e.g. quiz.example.com)"
  type        = string
}

variable "letsencrypt_email" {
  description = "Email for Let's Encrypt registration / expiry notices"
  type        = string
}

variable "route53_zone_id" {
  description = "Optional Route53 hosted zone id. If set, Terraform creates the A record AND certbot runs automatically. Leave empty to manage DNS yourself."
  type        = string
  default     = ""
}

variable "win_score" {
  description = "Points needed to win"
  type        = number
  default     = 3
}

variable "shared_password" {
  description = "Optional shared join password for players (empty = none). Stored in Terraform state."
  type        = string
  default     = ""
  sensitive   = true
}

variable "super_admin_user" {
  description = "Super-admin username for the /admin.html panel."
  type        = string
  default     = "superadmin"
}

variable "super_admin_password" {
  description = "Super-admin password. REQUIRED to enable /admin.html — if empty, the super panel is locked and no admin accounts can be created. Stored in Terraform state."
  type        = string
  default     = ""
  sensitive   = true
}
