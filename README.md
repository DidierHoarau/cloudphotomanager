# cloudphotomanager

CloudPhotoManager is a self-hosted free and open source photo managegement tool. Photos and videos are not stored directly in the application, they are stored on 3rd party storage providers that the application needs to be connected to.

![](docs/images/cloudphotomanager_preview.png?raw=true)

# Features

- Supported Storage Providers: OneDrive, AWS S3, Local Drive
- Organize Photos by Folders
- Multiple users to be able to shared some folder to some users
- Detection of duplicates

# Installation

The only supported way to setup the application is with Docker containers.

[https://hub.docker.com/r/didierhoarau/cloudphotomanager]

## Kubernetes Setup

The following basic configuration can be used to setup the application on Kubernetes:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudphotomanager
  labels:
    app: cloudphotomanager
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudphotomanager
  template:
    metadata:
      labels:
        app: cloudphotomanager
    spec:
      priorityClassName: high-priority
      containers:
        - image: didierhoarau/cloudphotomanager:latest
          name: cloudphotomanager
          env:
            - name: ONEDRIVE_CLIENT_ID
              value: ... # Only needed for OneDrive
            - name: ONEDRIVE_CLIENT_SECRET
              value: ... # Only needed for OneDrive
            - name: ONEDRIVE_CALLBACK_SIGNIN
              value: ... Only needed for OneDrive
            - name: AWS_ACCESS_KEY_ID
              value: ... # Only needed for S3
            - name: AWS_SECRET_ACCESS_KEY
              value: ... # Only needed for S3
            - name: AWS_DEFAULT_REGION
              value: ... # Only needed for S3
          volumeMounts:
            - mountPath: /data
              name: pod-volume
      volumes:
        - name: pod-volume
          persistentVolumeClaim:
            claimName: cloudphotomanager
---
apiVersion: v1
kind: Service
metadata:
  name: cloudphotomanager
spec:
  ports:
    - name: tcp
      port: 80
      targetPort: 80
  selector:
    app: cloudphotomanager
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cloudphotomanager
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
```
