#! /bin/sh

if [ "$1" == "" ]; then
    echo "ERROR: Expected Omega's IP address as argument"
    exit
fi

ipAddr="$1"


npm run build
rsync -va dist/bundle.js root@$ipAddr:/www/setup-wizard/bundle.js
