FURL
====

FURL is a service written in Node.js to provide an HTTP API for resolving short URLs.

The service is running at http://furl.li/ so feel free to have a play, but please don't hammer it! Try this: http://furl.li/http://is.gd/w

It's highly recommended that this is run behind a mature web server such as nginx - this is advice from the creator of Node so pay attention Bond!

Configuration
-------------

* All configurable variables are at the top of the source file.

Usage
-----

* Call / and it will return the destination URL. If an error occurs it will return a message starting with ERR.
* Call it with /stats to get a JSON response containing various stats.
* Call it with /clean to trigger a cache cleaning operation. This will return the number of objects deleted during the clean.


TODO
----

* Move the configuration out to a conf file.
* Add the ability to have an hourly per-IP limit to prevent abuse.
* Add the option of using a memcached instance for the cache so it can be shared across multiple instances of the daemon behind a load balancer.
* I've not really stress-tested it yet, but the tests I have done show it to be pretty stable.

Contact
-------

Email:  support@3ft9.com
WWW:    http://3ft9.com/
GitHub: http://github.com/3ft9

--
Last updated: 2011-08-05 22:10
