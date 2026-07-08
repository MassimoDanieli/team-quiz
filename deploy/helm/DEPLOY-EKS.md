# Deploying Team Quiz to an existing EKS cluster

Same app, containerised. The persistence layer is unchanged: `store.js` still writes a
JSON file, but `DATA_FILE` points at an EBS-backed PVC mounted at `/data`.

```
  player --HTTPS--> ALB (ACM cert) --HTTP--> Service --> Pod (node:3000)
                                                          |
                                                     PVC on EBS (/data/state.json)
```

## Why single replica
Game state (players, teams, votes, current question) and the question history live in
one process. The chart pins `replicaCount: 1` and uses a `Recreate` update strategy so
the RWO EBS volume is never contended by two pods. Multiple replicas would require a
Socket.IO Redis adapter, sticky sessions and externalised state — unnecessary here.

## Cluster prerequisites
- **AWS Load Balancer Controller** (for the ALB Ingress).
- **EBS CSI driver** and a `gp3` StorageClass (adjust `persistence.storageClass` if yours
  is named differently, e.g. `ebs-sc`).
- An **ACM certificate** for `quiz.massimodanieli.com` in the ALB's region (eu-west-2),
  in status *Issued*. Validate it with a DNS record (add the CNAME ACM gives you in
  Cloudflare).

## 1. Build and push the image to Artifactory
```bash
ART=your-artifactory.example.com/docker-local
docker login your-artifactory.example.com

# If you build with buildx/BuildKit, disable provenance attestations so the push is a
# plain image manifest (avoids the manifest-list issues you hit on ECR):
docker build --provenance=false -t $ART/team-quiz:1.0.0 .
docker push $ART/team-quiz:1.0.0
```

## 2. Namespace + image pull secret
```bash
kubectl create namespace early-talent

kubectl -n early-talent create secret docker-registry artifactory-cred \
  --docker-server=your-artifactory.example.com \
  --docker-username='<user>' \
  --docker-password='<token>'
```

## 3. Install the chart
Create a `my-values.yaml` (don't commit secrets):
```yaml
image:
  repository: your-artifactory.example.com/docker-local/team-quiz
  tag: "1.0.0"
imagePullSecrets:
  - name: artifactory-cred
ingress:
  host: quiz.massimodanieli.com
  certificateArn: arn:aws:acm:eu-west-2:<acct>:certificate/<id>
app:
  winScore: 3
  # sharedPassword: "letmein"   # or use app.existingSecret to reference a managed Secret
persistence:
  storageClass: gp3
  size: 1Gi
```
```bash
helm lint deploy/helm/team-quiz
helm template tq deploy/helm/team-quiz -f my-values.yaml   # eyeball the output
helm upgrade --install tq deploy/helm/team-quiz -n early-talent -f my-values.yaml
```

## 4. Point DNS at the ALB
```bash
kubectl -n early-talent get ingress tq-team-quiz \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'; echo
```
In Cloudflare add a **CNAME**: `quiz` -> that ALB hostname. Start with **DNS only**
(grey cloud). The ACM cert on the ALB is publicly trusted, so if you later want the
Cloudflare proxy on, use SSL mode *Full (strict)*.

Then open `https://quiz.massimodanieli.com` (players) and `/host.html` (host).

## Upgrades
```bash
docker build --provenance=false -t $ART/team-quiz:1.1.0 .
docker push $ART/team-quiz:1.1.0
helm upgrade tq deploy/helm/team-quiz -n early-talent -f my-values.yaml --set image.tag=1.1.0
```
`Recreate` means a few seconds of downtime while the pod swaps — fine for this.
Roll back with `helm rollback tq -n early-talent`.

## Operating
```bash
kubectl -n early-talent get pods,svc,ingress,pvc
kubectl -n early-talent logs deploy/tq-team-quiz -f
```
- Config: `WIN_SCORE` in the ConfigMap, `SHARED_PASSWORD` via the Secret.
- Question history persists on the PVC at `/data/state.json`; it survives pod restarts
  and reschedules. **Note:** an EBS volume is AZ-bound, so the pod will schedule in the
  volume's AZ. Reset the history any time from the host panel ("Reset question history").
- New question set / app change → rebuild image, bump tag, `helm upgrade`.

## Notes
- Migrating history from the EC2 box isn't needed (the new question set uses fresh ids).
  If you ever want to, copy its `state.json` into the PVC.
- WebSockets: the chart sets the ALB idle timeout to 3600s
  (`ingress.idleTimeoutSeconds`) so long-lived Socket.IO connections aren't dropped.
