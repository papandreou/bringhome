const AssetGraph = require('assetgraph');
const urlTools = require('urltools');
const urlModule = require('url');
const writeFileAsync = require('util').promisify(require('fs').writeFile);
const uniq = require('lodash.uniq');
const yargs = require('yargs');

module.exports = async function cliTool(argv, console) {
  const {
    output,
    'omit-scripts': omitScripts,
    recursive,
    pretty,
    'self-contained': selfContained,
    silent,
    header: headers,
    _: nonOptionArgs
  } = yargs(argv)
    .usage('$0 https://example.com/ -o localdir')
    .options('output', {
      alias: 'o',
      describe:
        'Directory where results should be written to (or file in --self-contained mode)',
      type: 'string',
      demand: true
    })
    .options('header', {
      alias: 'H',
      describe:
        "Specify a custom header and value to pass when retrieving assets, eg. -H 'Foo: bar'. Can be repeated",
      type: 'string',
      array: true,
      default: []
    })
    .options('recursive', {
      alias: 'r',
      describe:
        'Crawl all HTML-pages linked with relative and root relative links. This stays inside your domain',
      type: 'boolean',
      default: false
    })
    .options('pretty', {
      describe: 'Pretty print downloaded assets',
      type: 'boolean',
      default: false
    })
    .options('omit-scripts', {
      describe: 'Leave out JavaScript',
      type: 'boolean',
      default: false
    })
    .options('self-contained', {
      describe:
        'Inline all assets, producing a single, self-contained "archive" HTML file. Alters the meaning of the --output switch so it specifies the desired location of the file',
      type: 'boolean',
      default: false
    })
    .options('silent', {
      alias: 's',
      describe: 'Do not write anything to stdout',
      type: 'boolean',
      default: false
    })
    .demand(1)
    .wrap(72).argv;

  const inputUrls = nonOptionArgs.map(arg =>
    /^https?:\/\//i.test(arg) ? arg : `http://${arg}`
  );

  if (selfContained && inputUrls.length > 1) {
    throw new Error('--self-contained mode only supports a single input url');
  }

  const assetGraph = new AssetGraph();
  const teepeeHeaders = assetGraph.teepee.headers;
  for (const header of headers) {
    var matchKeyValue = header.match(/^([^:]*):\s?(.*)$/);
    if (matchKeyValue) {
      const [, name, value] = matchKeyValue;
      if (Array.isArray(teepeeHeaders[name])) {
        teepeeHeaders[name].push(value);
      } else if (teepeeHeaders[name] === undefined) {
        teepeeHeaders[name] = value;
      } else {
        teepeeHeaders[name] = [teepeeHeaders[name], value];
      }
    } else {
      throw new Error('Cannot parse header: ' + header);
    }
  }

  // In selfContained mode this will come out as file:///path/to/index.html/
  // We'll deal with that case further below
  const outRoot = output && urlTools.urlOrFsPathToUrl(output, true);

  const resourceHintTypes = [
    'HtmlPreconnectLink',
    'HtmlPrefetchLink',
    'HtmlPreloadLink',
    'HtmlPrerenderLink',
    'HtmlDnsPrefetchLink'
  ];

  const omitTypes = [];
  if (omitScripts) {
    omitTypes.push(
      'HtmlScript',
      'HtmlInlineEventHandler',
      'SvgScript',
      'SvgInlineEventHandler',
      'HtmlServiceWorkerRegistration'
    );
  }

  const anchorTypes = ['HtmlAnchor', 'SvgAnchor', 'HtmlMetaRefresh'];

  const noFollowRelationTypes = [
    ...anchorTypes,
    ...resourceHintTypes,
    ...omitTypes,
    'HtmlOpenGraph',
    'RssChannelLink',
    'JsonUrl'
  ];

  let followRelationsQuery;
  if (recursive) {
    followRelationsQuery = {
      $or: [
        {
          type: {
            $nin: noFollowRelationTypes
          }
        },
        { type: { $nin: resourceHintTypes }, crossorigin: false }
      ]
    };
  } else {
    noFollowRelationTypes.push('HtmlAlternateLink');
    followRelationsQuery = {
      type: {
        $nin: noFollowRelationTypes
      }
    };
  }

  if (silent) {
    // Avoid failing on assetGraph.warn
    // It would be better if logEvents supported a custom console implementation
    assetGraph.on('warn', () => {});
  } else {
    await assetGraph.logEvents();
  }
  await assetGraph.loadAssets(inputUrls);
  await assetGraph.populate({
    followRelations: followRelationsQuery
  });

  await assetGraph.checkIncompatibleTypes();

  for (const relation of assetGraph
    .findRelations({ type: 'HttpRedirect' })
    .sort((a, b) => a.id - b.id)) {
    if (relation.from.isInitial) {
      assetGraph.warn(
        new Error(`${relation.from.url} redirected to ${relation.to.url}`)
      );
      relation.to.isInitial = true;
      relation.from.isInitial = false;
    }
  }

  const origins = uniq(
    assetGraph
      .findAssets({ isInitial: true })
      .map(asset => new urlModule.URL(asset.url).origin)
  );
  if (origins.length > 1) {
    throw new Error(
      'The pages to bring home must have the same origin, but saw multiple:\n  ' +
        origins.join('\n  ')
    );
  }
  const origin = origins[0];

  for (const redirect of assetGraph.findRelations({
    type: 'HttpRedirect'
  })) {
    for (const incomingRelation of redirect.from.incomingRelations) {
      incomingRelation.to = redirect.to;
    }
    assetGraph.removeAsset(redirect.from);
  }

  if (pretty) {
    for (const asset of assetGraph.findAssets({ isLoaded: true })) {
      if (asset.prettyPrint) {
        asset.prettyPrint();
      }
    }
  }

  for (const relation of assetGraph.findRelations({
    hrefType: { $in: ['rootRelative', 'protocolRelative', 'absolute'] }
  })) {
    relation.hrefType =
      relation.type === 'JavaScriptStaticUrl' ? 'rootRelative' : 'relative';
  }

  // Make sure that JavaScriptStaticUrl relations don't end up as relative
  // because fromUrl and toUrl are outside assetGraph.root:
  assetGraph.root = outRoot;

  await assetGraph.moveAssets(
    { isInline: false, isLoaded: true },
    (asset, assetGraph) => {
      let baseUrl;
      if (asset.origin === origin) {
        baseUrl = outRoot;
      } else {
        baseUrl = `${outRoot}${asset.hostname}${
          asset.port ? `:${asset.port}` : ''
        }/`;
      }
      return urlModule.resolve(
        baseUrl,
        `${asset.path.replace(/^\//, '')}${asset.baseName ||
          'index'}${asset.extension || asset.defaultExtension}`
      );
    }
  );

  // Make sure no asset file names collide with implicit dirs so that
  // writeAssetsToDisc is safe:
  const reservedUrls = new Set();
  for (const asset of assetGraph.findAssets({
    isInline: false,
    isLoaded: true
  })) {
    if (asset.url.startsWith(outRoot)) {
      const relative = urlTools.buildRelativeUrl(outRoot, asset.url);
      if (relative.includes('/')) {
        const fragments = relative.split('/').slice(0, -1);
        for (let i = 0; i < fragments.length; i += 1) {
          reservedUrls.add(outRoot + fragments.slice(0, i + 1).join('/'));
        }
      }
    }
  }

  for (const asset of assetGraph.findAssets({
    url: {
      $in: [...reservedUrls]
    }
  })) {
    let nextSuffixToTry = 1;
    let targetUrl;
    do {
      targetUrl = urlModule.resolve(
        asset.url,
        `${asset.baseName}-${nextSuffixToTry}${asset.extension ||
          asset.defaultExtension}`
      );
      nextSuffixToTry += 1;
    } while (assetGraph._urlIndex[targetUrl]);
    asset.url = targetUrl;
  }

  if (omitTypes.length > 0) {
    for (const relation of assetGraph.findRelations({
      type: { $in: omitTypes }
    })) {
      relation.detach();
    }
  }

  if (selfContained) {
    await assetGraph.inlineRelations({
      to: { isLoaded: true },
      type: {
        $nin: [...noFollowRelationTypes, 'SourceMapFile', 'SourceMapSource']
      }
    });
  }

  // Hack: Find a better way to kill <noscript>
  // This kills the relations (but it works out because we do it right before serializing)
  if (omitScripts) {
    for (const noScriptRelation of assetGraph.findRelations({
      type: 'HtmlNoscript'
    })) {
      for (const childNode of [...noScriptRelation.to.parseTree.childNodes]) {
        noScriptRelation.node.parentNode.insertBefore(
          childNode,
          noScriptRelation.node
        );
      }
      noScriptRelation.detach();
      noScriptRelation.from.markDirty();
    }
  }

  if (selfContained) {
    await writeFileAsync(
      output,
      assetGraph.findAssets({ isInitial: true })[0].rawSrc
    );
  } else {
    await assetGraph.writeAssetsToDisc(
      {
        isLoaded: true,
        url: url => url.startsWith(outRoot)
      },
      outRoot,
      outRoot
    );
  }

  if (!silent) {
    console.log('Output written to', outRoot);
  }
};
