# Deploying Team Quiz to EC2 (Terraform)

This provisions a single Ubuntu 22.04 EC2 instance with an Elastic IP, a security
group, nginx as a reverse proxy, and a Let's Encrypt certificate. The Node app is
deployed and started under systemd automatically.

```
            HTTPS                     proxy
  player ---------> nginx :443 ----------------> node :3000
                    (Let's Encrypt cert)
```

## Prerequisites
- Terraform >= 1.3 and AWS credentials configured (`aws configure` / env vars / SSO).
- An existing **EC2 key pair** and the matching private key file locally.
- A **domain** you can point at an IP (anywhere — Route53 or any other DNS).

## 1. Configure
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: key_name, ssh_private_key_path, domain_name, letsencrypt_email
```
Lock `ssh_ingress_cidr` to your own IP (`x.x.x.x/32`) if you can.

## 2. Apply
```bash
terraform init
terraform apply
```
Terraform creates the instance + Elastic IP, then uploads the app and runs the setup
script over SSH (installs Node, nginx, certbot; starts the service). It prints the
Elastic IP and next steps.

## 3. DNS + HTTPS

**If you set `route53_zone_id`** in tfvars: Terraform creates the A record and the
setup script waits for DNS then runs certbot automatically. Done.

**Otherwise** (any other DNS provider):
1. Create an A record: `your.domain -> <public_ip from output>`.
2. Once it resolves, finish HTTPS:
   ```bash
   ssh -i <your-key.pem> ubuntu@<public_ip>
   /opt/team-quiz/enable-https.sh
   ```

Then open `https://your.domain` (players) and `https://your.domain/host.html` (host).

## Updating the app later
Re-running `terraform apply` re-deploys when `server.js` or `setup.sh` changes (the
`null_resource` triggers on their hashes). Or push a change by hand:
```bash
scp -i <key.pem> server.js ubuntu@<ip>:/opt/team-quiz/server.js
ssh -i <key.pem> ubuntu@<ip> 'sudo systemctl restart team-quiz'
```

## Operating the box
```bash
sudo systemctl status team-quiz       # service state
journalctl -u team-quiz -f            # live logs
sudo systemctl restart team-quiz      # restart
```
- App config lives in `/etc/team-quiz.env` (PORT, WIN_SCORE, SHARED_PASSWORD, DATA_FILE).
- Question history persists at `/var/lib/team-quiz/state.json` (survives restarts; lost
  only if the instance is destroyed).
- Certificates auto-renew via the certbot systemd timer.

## Cost & teardown
A `t3.micro` + Elastic IP is a few dollars a month (the EIP is free only while attached
to a running instance). Tear everything down with:
```bash
terraform destroy
```

## Notes
- `shared_password` is written to Terraform state and to `/etc/team-quiz.env`. Fine for a
  quiz password; don't reuse a real secret. Avoid single quotes in the value.
- Single instance = single game room and no HA. That's the right size for this. If you
  ever need more, the app would need state keyed per room and a shared store.
