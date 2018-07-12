const AssetGraph = require('assetgraph');
const urlTools = require('urltools');
const urlModule = require('url');
const writeFileAsync = require('util').promisify(require('fs').writeFile);
const uniq = require('lodash.uniq');

module.exports = async function cliTool(
  { output, inputUrls, recursive, selfContained, omitScripts, debug },
  console
) {
  if (selfContained && inputUrls.length > 1) {
    throw new Error('--self-contained mode only supports a single input url');
  }

  // In selfContained mode this will come out as file:///path/to/index.html/
  // We'll deal with that case further below
  const outRoot = output && urlTools.urlOrFsPathToUrl(output, true);

  const origins = uniq(
    inputUrls.map(inputUrl => new urlModule.URL(inputUrl).origin)
  );
  if (origins.length > 1) {
    throw new Error(
      'The pages to bring home must have the same origin, but saw multiple:\n  ' +
        origins.join('\n  ')
    );
  }
  const origin = origins[0];

  const resourceHintTypes = [
    'HtmlPreconnectLink',
    'HtmlPrefetchLink',
    'HtmlPreloadLink',
    'HtmlPrerenderLink',
    'HtmlDnsPrefetchLink'
  ];

  const omitTypes = [];
  if (omitScripts) {
    omitTypes.push('HtmlScript', 'SvgScript', 'HtmlInlineEventHandler');
  }

  const anchorTypes = ['HtmlAnchor', 'SvgAnchor', 'HtmlMetaRefresh'];

  const noFollowRelationTypes = [
    ...anchorTypes,
    ...resourceHintTypes,
    ...omitTypes,
    'HtmlOpenGraph',
    'RssChannelLink'
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

  const assetGraph = new AssetGraph();
  if (debug) {
    await assetGraph.logEvents();
  }
  await assetGraph.loadAssets(inputUrls);
  await assetGraph.populate({
    followRelations: followRelationsQuery
  });

  for (const relation of assetGraph.findRelations({
    hrefType: { $in: ['rootRelative', 'protocolRelative', 'absolute'] }
  })) {
    relation.hrefType = 'relative';
  }

  await assetGraph.moveAssetsInOrder(
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
        `${asset.path.replace(/^\//, '')}${asset.fileName ||
          `index${asset.defaultExtension}`}`
      );
    }
  );

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

  console.log('Output written to', outRoot);
};
