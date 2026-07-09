output "public_ip" {
  description = "Elastic IP of the instance — point your domain's A record here"
  value       = aws_eip.quiz.public_ip
}

output "ssh_command" {
  description = "SSH into the box"
  value       = "ssh -i ${var.ssh_private_key_path} ubuntu@${aws_eip.quiz.public_ip}"
}

output "url" {
  description = "Where the quiz will live once HTTPS is enabled"
  value       = "https://${var.domain_name} (host panel: https://${var.domain_name}/host.html)"
}

output "next_steps" {
  value = var.route53_zone_id == "" ? join("\n", [
    "DNS is NOT managed by Terraform:",
    "  1. Create an A record: ${var.domain_name} -> ${aws_eip.quiz.public_ip}",
    "  2. Wait for it to resolve, then:",
    "     ssh -i ${var.ssh_private_key_path} ubuntu@${aws_eip.quiz.public_ip}",
    "     /opt/team-quiz/enable-https.sh",
    ]) : join("\n", [
    "Route53 record created and certbot attempted automatically.",
    "If HTTPS isn't up yet, SSH in and run /opt/team-quiz/enable-https.sh"
  ])
}
