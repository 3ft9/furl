/*
 furl.js - full URL resolution API

 This is a simple Node.js process that presents a web server with a very
 simple API. Call it with /<url_to_resolve> and it will respond the
 destination URL. If an error occurs it will respond with a message starting
 with ERR.

 Call it with /stats to get a JSON response containing various stats.

 Call it with /clean to trigger a cache cleaning operation. This will return
 the number of objects deleted during the clean.

 The an in-memory cache managed whose size is managed by the global variables
 below.

 It's highly recommended that this is run behind a mature web server such as
 nginx - this is advice from the creator of Node so pay attention Bond!
*/

var http = require('http'),
    url = require('url'),
    fs = require('fs');

// Set this to true to get some logging
var DEBUG = true;

// Port on which the API server should listen
var PORT = 34737;

// We stop when we hit this number of checked URLs per request
var MAX_HOPS = 10;

// How long to wait for a response from a server (ms)
var REQUEST_TIMEOUT = 5000;

// The URL cache
var CACHE = {};

// How often to check the memory usage
var MEMORY_CHECK_INTERVAL = 60000; // every minute

// How often the cache cleaner runs (ms)
var CACHE_CLEANER_INTERVAL = 3600000; // hourly

// The maximum age of cache entries (ms)
var MAX_CACHE_AGE = 86400 * 7 * 1000; // 1 week

// Ramp up time for the cache cleaner - if too much memory is being used then
// this number of ms is decremented from the max age until memory usage comes
// under control
var CACHE_AGE_RAMPUP = 86400 * 1000; // 1 day

// The maximum allowed vsize - initial vsize (i.e. cache size)
var MAX_MEMORY_USAGE = 1024 * 1024 * 64; // A very conservative 64MB

// Make a note of the initial memory usage so we can use it to determine the
// usage by our cache
var INITIAL_MEMORY_USAGE = process.memoryUsage().vsize;

// This variable holds the HTML for the index page (/)
var indexHTML = 'Loading...';
// Load the index page
fs.readFile('./index.html', function (err, doc) { indexHTML = (err ? err : doc.toString()); });
// Watch the file for changes
fs.watchFile('./index.html', function(curr,prev)
{
	if (curr.mtime.getTime() != prev.mtime.getTime())
	{
		// Reload the file
		if (DEBUG) console.log('Reloading index.html...');
		fs.readFile('./index.html', function (err, doc) { indexHTML = (err ? err : doc.toString()); });
	}
});

// Stats
var STATS = {
	'cache': {
		'hits': 0,
		'misses': 0,
		'size': 0,
		'memory': 0,
	},
	'responses': {
		'successful': 0,
		'failures': 0,
		'last': 0,
	},
	'total_hops': 0,
	'cleaner': {
		'runs': 0,
		'cleaned': 0,
		'last': 0,
		'lastduration': 0,
	},
};

// The current version number
var VERSION = '0.1';

// The resolveURL function which does exactly what you might expect
var resolveURL = function(urlin, callback, trail, lasturl)
{
	// Check the cache first
	if (CACHE[urlin])
	{
		STATS.cache.hits++;
		CACHE[urlin].lastaccess = new Date().getTime();
		callback(CACHE[urlin].code, CACHE[urlin].text);
		return;
	}
	STATS.cache.misses++;

	// Initialise the trail if necessary
	if (!trail)
	{
		trail = [];
	}

	// Make sure this URL has not been seen yet
	if (trail.indexOf(urlin) != -1)
	{
		sendResult(400,
			'ERR Circular reference found after ' + trail.length + ' hop' +
				(trail.length == 1 ? '' : 's') + ', pointing back to ' + urlin,
			callback, trail);
		return;
	}

	// Add this URL to the trail
	trail.push(urlin);

	// Stop if we've hit the maximum number of hops
	if (trail.length >= MAX_HOPS)
	{
		sendResult(400, 'ERR Too many hops', callback, trail);
		return;
	}

	// Parse the URL
	var uri = url.parse(urlin)

	// Make sure we have a valid HTTP or HTTPS URL
	if (!uri.protocol || (uri.protocol != 'http:' && uri.protocol != 'https:'))
	{
		sendResult(400,
			'ERR Invalid protocol: ' + urlin, callback, trail);
		return;
	}

	// Make sure we have a hostname
	if (!uri.hostname)
	{
		sendResult(400, 'ERR Invalid URL: Missing hostname', callback, trail);
		return;
	}

	// Set some defaults for missing uri parts
	if (!uri.port) uri.port = (uri.protocol == 'https:' ? 443 : 80);
	if (!uri.pathname) uri.pathname = '/';
	if (!uri.search) uri.search = '';

	STATS.total_hops++;

	// Make the HEAD request
	var client = http.createClient(uri.port, uri.hostname, (uri.protocol == 'https:'));
	// This is the request object
	var headreq = client.request('HEAD', uri.pathname + uri.search,
		{
			'Host': uri.hostname + (uri.port != 80 ? ':' + uri.port : ''),
			'User-Agent': 'furl/' + VERSION,
			'Referer': (lasturl ? lasturl : 'http://furl.3ft9.com/'),
			'Accept': '*/*',
		});
	// This sets up a timer to trigger a timeout
	var timeouttimer = setTimeout(function()
	{
		if (headreq) headreq.emit('mytimeout');
	}, REQUEST_TIMEOUT);
	// This will get called if the timer times out
	headreq.on('mytimeout', function()
	{
		sendResult(500, 'ERR Request to ' + urlin + ' timed out',
			callback, trail);
	});
	// This will get called when we get a response
	headreq.on('response', function(headres)
	{
		clearTimeout(timeouttimer);
		// Redirection?
		if (headres.statusCode == 301 || headres.statusCode == 302)
		{
			if (headres.headers.location)
			{
				// We have a location header so we've got another URL to check
				resolveURL(headres.headers.location, callback, trail, urlin);
			}
			else
			{
				sendResult(500,
					'ERR ' + headres.statusCode + ' response without a location header',
					callback, trail);
			}
		}
		else if (headres.statusCode != 200)
		{
			// Got a non-200/301/302 response from the server, tell our client
			sendResult(headres.statusCode, urlin, callback, trail);
		}
		else
		{
			// Otherwise we're done
			sendResult(200, urlin, callback, trail);
		}
	});
	// This will get called if an error occurs
	headreq.on('error', function(e)
	{
		clearTimeout(timeouttimer);
		// Ignore timeout errors - we handle those differently
		if (e.message.indexOf('ETIMEDOUT') != 0)
		{
			sendResult(500, 'ERR ' + e.message + ' for ' + urlin, callback, trail);
		}
	});
	headreq.end();
}

// Send the result and store the mapping in the
var sendResult = function(code, text, callback, trail)
{
	// Send the response to the caller
	callback(code, text);

	// Store the mapping in the cache
	var now = new Date().getTime();
	if (code != 200)
	{
		// Store errors for a tenth the time we store successes by forcing the
		// last access time to be 9/10 of the max age ago
		now -= (0.9 * MAX_CACHE_AGE);
	}

	// Store one entry for each URL hit during resolution
	for (var key in trail)
	{
		CACHE[trail[key]] = { 'lastaccess': now, 'code': code, 'text': text };
	}
}

// This is the cache cleaner function
var CLEANER_RUNNING = false;
var cacheCleaner = function()
{
	// Only allow the cleaner to run once at any given time
	if (CLEANER_RUNNING) return;

	CLEANER_RUNNING = true;

	STATS.cleaner.runs++;
	STATS.cleaner.last = new Date().getTime();

	if (DEBUG) console.log('Cache cleaner running');

	// Work out the cutoff time
	var cutoff = new Date().getTime() - MAX_CACHE_AGE;

	// Keep track of the number of items cleaned
	var numcleaned = 0;

	do
	{
		// Get a list of the keys to be deleted from the cache
		var keys = [];
		for (var key in CACHE)
		{
			if (CACHE[key] && CACHE[key].lastaccess < cutoff)
			{
				keys.push(key);
			}
		}

		// Check each item in the cache and delete if the last access was older
		// than the cutoff
		for (var key in keys)
		{
			// Check things again, they might have changed by now
			if (CACHE[keys[key]] && CACHE[keys[key]].lastaccess < cutoff)
			{
				delete CACHE[keys[key]];
				numcleaned++;
			}
		}

		// In preparation for another loop, increase the cutoff
		cutoff += CACHE_AGE_RAMPUP;

		if (DEBUG) console.log('Memory: ' + getStats().cache.memory + '%');
	}
	while (process.memoryUsage().rss > MAX_MEMORY_USAGE);

	CLEANER_RUNNING = false;

	STATS.cleaner.cleaned += numcleaned;

	STATS.cleaner.lastduration = new Date().getTime() - STATS.cleaner.last;

	if (DEBUG)
	{
		console.log(getStats());
		console.log('Cleanup complete (' + numcleaned + ')');
	}

	return numcleaned;
}

// Get the stats
var getStats = function()
{
	STATS.cache.size = Object.keys(CACHE).length;
	mem = (100 / MAX_MEMORY_USAGE) * (process.memoryUsage().vsize - INITIAL_MEMORY_USAGE);
	STATS.cache.memory = Math.round(mem*Math.pow(10,2))/Math.pow(10,2)
	return STATS;
}

// Exception catch-all
process.on('uncaughtException', function (err)
{
	if (err.indexOf('TypeError') == -1)
	{
		console.log('Uncaught exception: ' + err);
	}
});

// Create the HTTP server
http.createServer(function (req, res)
	{
		if (req.url == '/')
		{
			res.writeHead(200, {'Content-Type': 'text/html'});
			res.end(indexHTML);
		}
		else if (req.url == '/favicon.ico')
		{
			res.writeHead(200, {'Content-Type': 'image/x-icon'});
			res.end();
		}
		else if (req.url == '/robots.txt')
		{
			res.writeHead(200, {'Content-Type': 'text/plain'});
			res.end('User-agent: *\nDisallow: /http://');
		}
		else if (req.url == '/stats')
		{
			// Stats request, send them
			res.writeHead(200, {'Content-Type': 'application/json'});
			res.end(JSON.stringify(getStats()));
		}
		else if (req.url == '/clean')
		{
			// Stats request, send them
			res.writeHead(200, {'Content-Type': 'text/plain'});
			res.end(cacheCleaner().toString());
		}
		else
		{
			// Resolve the URL
			resolveURL(req.url.substring(1), function(code, text)
			{
				// Send the response
				res.writeHead(code, {'Content-Type': 'text/plain'});
				res.end(text);

				// Stats
				STATS.responses.last = new Date().getTime();
				if (code == 200)
				{
					STATS.responses.successful++;
				}
				else
				{
					STATS.responses.failures++;
				}

				// Output the summary
				if (DEBUG) console.log(req.url.substring(1) + ' => ' + code + ' ' + text);
			});
		}
	}).listen(PORT);

// This is the cache cleaner
setInterval(function()
{
	cacheCleaner();
}, CACHE_CLEANER_INTERVAL);

// We also run this to check the memory usage more often
setInterval(function()
{
	var mem = getStats().cache.memory;
	if (mem >= 90)
	{
		cacheCleaner();
	}
	if (DEBUG)
	{
		console.log('Memory usage: ' + mem + '%');
	}
}, MEMORY_CHECK_INTERVAL);

// We're running, tell the world!
if (DEBUG) console.log('Server running on port ' + PORT);
