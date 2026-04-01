#!/bin/bash
set -e

# Amazon Linux 2023 setup
dnf update -y
dnf install -y docker git nodejs20 npm
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install pnpm
npm install -g pnpm

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create app directory
mkdir -p /opt/communitygate
chown ec2-user:ec2-user /opt/communitygate

# Signal complete
touch /opt/communitygate/.setup-complete
echo "Setup complete at $(date)" >> /var/log/communitygate-setup.log
