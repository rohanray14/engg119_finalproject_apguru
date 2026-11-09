#!/usr/bin/env bash
set -o errexit

# Python dependencies
pip install -r requirements-api.txt

# Build Next.js static export
cd web
npm ci
NEXT_PUBLIC_API_URL="" npm run build
cd ..
