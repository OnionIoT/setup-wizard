#! /bin/sh

bDebug=0


if [ "$1" == "" ]; then
    echo "ERROR: Expected Omega's IP address as argument"
    exit
fi
if [ "$2" == "debug" ]; then
    bDebug=1
fi

ipAddr="$1"

if [ $bDebug -eq 0 ]; then
    npm run build
    rsync -va dist/bundle.js root@$ipAddr:/www/setup-wizard/js/bundle.js
else
    rsync -va src/main.js  root@$ipAddr:/www/setup-wizard/js/bundle.js  
fi
