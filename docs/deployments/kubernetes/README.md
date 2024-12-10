# Deploying with Kubernetes.

In the [cloudphotomanager] directory, you will find an example of deployment using Yaml files (with Kustomize)

To Launch the application in Kubenetes:

```bash
git clone https://github.com/DidierHoarau/cloudphotomanager
cd cloudphotomanager/docs/deployments/kubernetes/cloudphotomanager
kubectl kustomize . | kubectl apply -f -
```
