'use strict';

var $ = require('modmod')('chalk', 'fs', 'path');

var bowerDirectory;
var emitter;
var fileTypes;
var filesCaught = [];
var globalConfig;
var globalDependencies;
var globalDependenciesSorted;
var ignorePath;


/**
 * Inject dependencies into the specified source file.
 *
 * @param  {object} config  the global configuration object.
 * @return {object} config
 */
function injectDependencies(config) {
  var stream = config.get('stream');

  bowerDirectory = config.get('bower-directory');
  emitter = config.get('emitter');
  filesCaught = [];
  globalConfig = config;
  globalDependencies = config.get('global-dependencies').get();
  globalDependenciesSorted = config.get('global-dependencies-sorted');
  ignorePath = config.get('ignore-path');
  fileTypes = config.get('file-types');

  if (stream.src) {
    config.set('stream', {
      src: injectScriptsStream(stream.path, stream.src, stream.fileType),
      fileType: stream.fileType
    });
  } else {
    config.get('src').forEach(injectScripts);
  }

  return config;
}


function getReplaceFunction(file, fileType, returnType) {
  var replace = {};
  replace.blocks = [];
  replace.dependencies = {};

  /**
   * Callback function after matching our regex from the source file.
   *
   * @param  {array}  match       strings that were matched
   * @param  {string} startBlock  the opening <!-- bower:xxx --> comment
   * @param  {string} spacing     the type and size of indentation
   * @param  {string} blockType   the type of block (js/css)
   * @param  {string} oldScripts  the old block of scripts we'll remove
   * @param  {string} endBlock    the closing <!-- endbower --> comment
   * @return {string} the new file contents
   */
  replace.replace = function (match, startBlock, spacing, blockType, oldScripts, endBlock, offset, string) {
    blockType = blockType || 'js';
    replace.blocks.push(blockType);

    var newFileContents = startBlock;
    var dependencies = globalDependenciesSorted[blockType] || [];

    replace.dependencies[blockType] = dependencies;

    (string.substr(0, offset) + string.substr(offset + match.length)).
      replace(oldScripts, '').
      replace(fileType.block, '').
      replace(fileType.detect[blockType], function (match, reference) {
        filesCaught.push(reference.replace(/['"\s]/g, ''));
        return match;
      });

    spacing = returnType + spacing.replace(/\r|\n/g, '');

    dependencies.
      forEach(function (filePath) {
        var pkg;

        if (globalConfig.get('include-self') && filePath.indexOf(bowerDirectory) === -1) {
          pkg = {
            bowerJson: globalConfig.get('bower.json')
          };
        } else {
          pkg = globalDependencies[filePath.match(new RegExp(bowerDirectory + '/([^/]+)'))[1]];
        }

        filePath = $.path.join(
          $.path.relative($.path.dirname(file), $.path.dirname(filePath)),
          $.path.basename(filePath)
        ).replace(/\\/g, '/').replace(ignorePath, '');

        if (filesCaught.indexOf(filePath) > -1) {
          return;
        }

        if (typeof fileType.replace[blockType] === 'function') {
          newFileContents += spacing + fileType.replace[blockType](filePath);
        } else if (typeof fileType.replace[blockType] === 'string') {
          newFileContents += spacing + fileType.replace[blockType].replace('{{filePath}}', filePath);
        }

        emitter.emit('path-injected', {
          block: blockType,
          file: file,
          package: pkg.bowerJson
        });
      });

    return newFileContents + spacing + endBlock;
  };

  return replace;
}


/**
 * Take a file path, read its contents, inject the Bower packages, then write
 * the new file to disk.
 *
 * @param  {string} filePath  path to the source file
 */
function injectScripts(filePath) {
  var contents = String($.fs.readFileSync(filePath));
  var fileExt = $.path.extname(filePath).substr(1);
  var fileType = fileTypes[fileExt] || fileTypes['default'];
  var returnType = /\r\n/.test(contents) ? '\r\n' : '\n';

  var replace = getReplaceFunction(filePath, fileType, returnType);

  var newContents = contents.replace(fileType.block, replace.replace);

  if (contents !== newContents) {
    $.fs.writeFileSync(filePath, newContents);

    emitter.emit('file-updated', {
      file: filePath,
      dependencies: replace.dependencies,
      blocks: replace.blocks
    });
  }
}


function injectScriptsStream(filePath, contents, fileExt) {
  var returnType = /\r\n/.test(contents) ? '\r\n' : '\n';
  var fileType = fileTypes[fileExt] || fileTypes['default'];

  var replace = getReplaceFunction(filePath, fileType, returnType);

  var newContents = contents.replace(fileType.block, replace.replace);

  emitter.emit('file-updated', {
    file: filePath,
    dependencies: replace.dependencies,
    blocks: replace.blocks
  });

  return newContents;
}


module.exports = injectDependencies;
