#!/usr/bin/env bash
# ==============================================================================
# YHealth Fleet Dashboard - Automated SSL & Deployment Initializer for KVM2
# Usage:
#   ./init-ssl.sh [DOMAIN] [EMAIL]
# Examples:
#   ./init-ssl.sh dashboard.yhealth.me admin@yhealth.me
#   ./init-ssl.sh                                       (Uses Self-Signed SSL)
# ==============================================================================

set -e

DOMAIN=$1
EMAIL=$2

echo "======================================================================"
echo "    YHealth Speaker Management Dashboard - KVM2 SSL Setup Script"
echo "======================================================================"

# 1. Prepare Directory Structure
mkdir -p ssl certbot/conf certbot/www

# 2. Check / Generate Initial SSL Certificates
if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
  echo ""
  echo ">> Generating bootstrap Self-Signed SSL certificate..."
  echo "   (This prevents Nginx from failing on startup before Let's Encrypt runs)"
  
  openssl req -x509 -nodes -newkey rsa:4096 -days 365 \
    -keyout ssl/key.pem \
    -out ssl/cert.pem \
    -subj "/CN=${DOMAIN:-localhost}/O=YHealth/OU=Fleet" \
    2>/dev/null

  chmod 600 ssl/key.pem
  chmod 644 ssl/cert.pem
  echo ">> Bootstrap SSL certificate generated in ./ssl/ (cert.pem, key.pem)"
fi

# 3. Build & Launch Docker Containers
echo ""
echo ">> Launching Dashboard & Nginx services..."
docker compose up -d --build

# 4. Request Real Let's Encrypt Certificate (if domain & email supplied)
if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  echo ""
  echo ">> Requesting Production Let's Encrypt Certificate for: $DOMAIN..."
  
  # Wait for Nginx to be ready
  sleep 5

  # Run Certbot ACME challenge
  docker compose run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    -d $DOMAIN \
    --email $EMAIL \
    --rsa-key-size 4096 \
    --agree-tos \
    --non-interactive \
    --force-renewal" certbot

  # Replace bootstrap certificates with genuine Let's Encrypt certificates
  if [ -d "certbot/conf/live/$DOMAIN" ]; then
    echo ">> Linking Let's Encrypt certificates to Nginx SSL directory..."
    cp -L "certbot/conf/live/$DOMAIN/fullchain.pem" ssl/cert.pem
    cp -L "certbot/conf/live/$DOMAIN/privkey.pem" ssl/key.pem

    # Reload Nginx with new certificate
    echo ">> Reloading Nginx with production TLS certificate..."
    docker compose exec nginx nginx -s reload
    echo ""
    echo "======================================================================"
    echo "  SUCCESS! Dashboard is securely live at: https://$DOMAIN"
    echo "======================================================================"
  else
    echo ">> Warning: Certbot did not generate live directory. Retaining self-signed SSL."
  fi
else
  echo ""
  echo "======================================================================"
  echo "  Dashboard is live with Self-Signed SSL at: https://<SERVER_IP>"
  echo "  To configure a trusted domain later, run:"
  echo "    ./init-ssl.sh yourdomain.com admin@yourdomain.com"
  echo "======================================================================"
fi
