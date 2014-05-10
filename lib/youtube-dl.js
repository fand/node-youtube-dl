var execFile  = require('child_process').execFile;
var fs        = require('fs');
var path      = require('path');
var url       = require('url');
var http      = require('http');
var streamify = require('streamify');
var request   = require('request');
var util      = require('./util');


// Check that youtube-dl file exists.
var file = path.join(__dirname, '..', 'bin', 'youtube-dl');
fs.exists(file, function(exists) {
  if (!exists) {
    throw new Error('youtube-dl file does not exist.');
  }
});

var isYouTubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;

// Check if win.
var isWin = /^win/.test(process.platform);

/**
 * Downloads a video.
 *
 * @param {String} url
 * @param {!Array.<String>} args
 * @param {!Object} options
 */
var ytdl = module.exports = function(url, args, options) {
  var stream = streamify({
    superCtor: http.ClientResponse,
    readable: true,
    writable: false
  });

  ytdl.getInfo(url, args, options, function(err, data) {
    if (err) {
      stream.emit('error', err);
      return;
    }

    var item = (!data.length) ? data : data.shift();

    var req = request(item.url);
    req.on('response', function(res) {
      if (res.statusCode !== 200) {
        stream.emit('error', new Error('status code ' + res.statusCode));
        return;
      }

      item.size = parseInt(res.headers['content-length'], 10);
      stream.emit('info', item);
    });
    stream.resolve(req);
  });

  return stream;
};


/**
 * Calls youtube-dl with some arguments and the `callback`
 * gets called with the output.
 *
 * @param {String} url
 * @param {Array.<String>} args
 * @param {Array.<String>} args2
 * @param {Object} options
 * @param {Function(!Error, String)} callback
 */
function call(video, args1, args2, options, callback) {
  var args = args1.concat(util.parseOpts(args2));

  // Parse url.
  var details = url.parse(video, true);
  var query = details.query;

  // Get possible IDs.
  var id = query.v || '';

  // Check for long and short youtube video url.
  if (!id && isYouTubeRegex.test(video)) {
    // Get possible IDs for youtu.be from urladdr.
    id = details.pathname.slice(1).replace(/^v\//, '');
  }

  if (id === '') {
      // not YouTube
      args.push(video);
  }
  else if (id === 'playlist') {
    args.push(video);
  } else {
    args.push('http://www.youtube.com/watch?v=' + id);
  }

  var opt = [file, args];

  if (isWin) { opt = ['python', [file].concat(args)]; }

  // Call youtube-dl to get the video info.
  execFile(opt[0], opt[1], options, function(err, stdout, stderr) {
    if (err) return callback(err);
    if (stderr) return callback(new Error(stderr.slice(7)));

    var data = stdout.trim().split(/\r?\n/);
    callback(null, data);
  });

}


/**
 * Filters video info data and returns reformated object.
 *
 * @param {Array.<String>} data
 */
function filterData(data) {
  return {
    title       : data.title,
    id          : data.id,
    url         : data.url,
    thumbnail   : data.thumbnail,
    description : data.description,
    filename    : data.title + '-' + data.id + '.' + data.ext,
    itag        : data.format_id,
    resolution  : data.width + "x" + data.height
  };
}


/**
 * Detect the text is JSON or not.
 *
 * @param {String} text
 */
function isJSON(text) {
  return !(/[^,:{}\[\]0-9.\-+Eaeflnr-u \n\r\t]/
    .test(text.replace(/"(\\.|[^"\\])*"/g, '')));
};


/**
 * Gets info from a video.
 *
 * @param {String} url
 * @param {Array.<String>} args
 * @param {Function(!Error, Object)} callback
 */
ytdl.getInfo = function(url, args, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (typeof args === 'function') {
    callback = args;
    options = {};
  }

  var defaultArgs = [
    '--simulate',   // prevent double-download
    '--dump-json',
    '-o "%(title)s-%(id).%(ext)s"'  // force filename
  ];

  call(url, defaultArgs, args, options, function(err, data) {
    if (err) return callback(err);

    // Parse JSONs.
    var playlist = [];
    for (var i=0; i < data.length; i++) {
      if (isJSON(data[i])) {
        var info = filterData(JSON.parse(data[i]));
        playlist.push(info);
      }
    }

    if (playlist.length === 1) {
      return callback(null, playlist[0]);
    } else {
      return callback(null, playlist);
    }

  });
};


var formatsRegex = /^(\d+)\s+([a-z0-9]+)\s+(\d+x\d+|d+p|audio only)/;

/**
 * Gets availble formats for the video.
 *
 * @param {String} url
 * @param {!Array.<String>} args
 * @param {Function(!Error, Object)} callback
 */
ytdl.getFormats = function(url, args, callback) {
  if (typeof args === 'function') {
    callback = args;
    args = [];
  }
  call(url, ['--dump-json'], args, null, function(err, data) {
    if (err) return callback(err);

    var id = '';
    var formats = [];
    var formats_raw = [];

    // Get formats info from JSON.
    for (var i=0; i < data.length; i++) {
      if (isJSON(data[i])) {
        var obj = JSON.parse(data[i]);
        id = obj.id;
        formats_raw = obj.formats;
      }
    }

    // Convert the format info.
    formats_raw.map(function(format) {
      var resolution = format.format.match(/ - ([^\(]+)/)[1].trim();
      formats.push({
        id         : id,
        itag       : format.format_id,
        filetype   : format.ext,
        resolution : resolution
      });
    });

    callback(null, formats);
  });
};
