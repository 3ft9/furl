#!/bin/sh
while :
do
	node furl.js | mail -s "FURL died" support@3ft9.com
	git pull
	sleep 2
done
