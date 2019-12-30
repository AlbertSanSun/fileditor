window.downloadAsHTML = (() => {
const collecteyData = {assets: {}};

/**
 * @param {Asset} asset - calculate a URL for this asset.
 * @returns {string} a URL to download a project file.
 */
const getProjectUrl = function (asset) {
    const assetIdParts = asset.assetId.split('.');
    const assetUrlParts = ['https://projects.scratch.mit.edu/', assetIdParts[0]];
    if (assetIdParts[1]) {
        assetUrlParts.push(assetIdParts[1]);
    }
    return collecteyData.projectJSON = assetUrlParts.join('');
};

/**
 * @param {Asset} asset - calculate a URL for this asset.
 * @returns {string} a URL to download a project asset (PNG, WAV, etc.)
 */
const getAssetUrl = function (asset) {
    const assetUrlParts = [
        'https://cdn.assets.scratch.mit.edu/',
        'internalapi/asset/',
        asset.assetId,
        '.',
        asset.dataFormat,
        '/get/'
    ];
    return collecteyData.assets[asset.assetId] = assetUrlParts.join('');
};

class LoadingProgress {
    constructor (callback) {
        this.total = 0;
        this.complete = 0;
        this.callback = callback;
    }

    on (storage) {
        const _this = this;
        const _load = storage.webHelper.load;
        storage.webHelper.load = function (...args) {
            const result = _load.call(this, ...args);
            _this.total += 1;
            _this.callback(_this);
            result.then(asset => {
                _this.complete += 1;
                _this.callback(_this, asset);
            });
            return result;
        };
    }
}

/**
 * Run the benchmark with given parameters in the location's hash field or
 * using defaults.
 */
const runBenchmark = function (id, logProgress) {
  return new Promise(res => {
    // Lots of global variables to make debugging easier
    // Instantiate the VM.
    const vm = new window.NotVirtualMachine();

    const storage = new ScratchStorage(); /* global ScratchStorage */
    const AssetType = storage.AssetType;
    storage.addWebStore([AssetType.Project], getProjectUrl);
    storage.addWebStore([AssetType.ImageVector, AssetType.ImageBitmap, AssetType.Sound], getAssetUrl);
    vm.attachStorage(storage);

    if (logProgress) new LoadingProgress(logProgress).on(storage);

    vm.downloadProjectId(id);

    vm.on('workspaceUpdate', () => {
        res(collecteyData);
    });

    // Run threads
    vm.start();
  });
};

function removePercentSection(str, key) {
  /*
  performs the following on str:
  % key %
  this part (and other parts surrounded in a similar fashion) will be removed
  % /key %
  returns str with the parts removed
  */
  const startKey = `% ${key} %`;
  const endKey = `% /${key} %`;
  while (str.includes(startKey) && str.includes(endKey)) {
    str = str.slice(0, str.indexOf(startKey))
      + str.slice(str.indexOf(endKey) + endKey.length);
  }
  return str;
}
function getDataURL(url) {
  return fetch(url).then(r => r.blob()).then(blob => new Promise(res => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.readAsDataURL(blob);
  }));
}
function downloadAsHTML(projectSrc, {
  title = 'Project',
  username = 'griffpatch',
  ratio16to9 = false,
  progressBar = true,
  fullscreen = true,
  log = console.log,
  monitorColour = null,
  cloudServer = false,
  projectId = null,
  noVM = false
} = {}) {
  log('Getting assets...');
  return Promise.all([
    // make preface variables
    projectSrc.id
      ? runBenchmark(projectSrc.id, ({complete, total}, file) => {
        log(complete + '/' + total + (file ? ` (+ ${file.data.length / 1000} kB ${file.dataFormat})` : ''))
      })
        .then(({assets, projectJSON}) => {
          log('Assembling assets...');
          return Promise.all([
            getDataURL(projectJSON).then(data => projectJSON = data),
            ...Object.keys(assets).map(assetId => getDataURL(assets[assetId]).then(data => assets[assetId] = data))
          ]).then(() => {
            return `var SRC = "id", PROJECT_JSON = "${projectJSON}",`
              + `ASSETS = ${JSON.stringify(assets)},`;
          });
        })
      : Promise.resolve(`var SRC = "file", FILE = "${projectSrc.data}",`),

    // fetch scripts
    noVM
      ? ''
      : fetch(ratio16to9
        ? 'https://sheeptester.github.io/scratch-vm/16-9/vm.min.js'
        : 'https://sheeptester.github.io/scratch-vm/vm.min.js')
        .then(r => r.text())
        .then(vmCode => {
          log('Scratch engine obtained...');
          // remove dumb </ script>s in comments
          return vmCode.replace('</scr' + 'ipt>', '');
        }),

    // fetch template
    fetch('./template.html').then(r => r.text())
  ]).then(([preface, scripts, template]) => {
    scripts = preface
      + `DESIRED_USERNAME = ${JSON.stringify(username)},`
      + `COMPAT = ${compatibility.checked}, TURBO = ${turbo.checked},`
      + `PROJECT_ID = ${JSON.stringify(projectId)};`
      + scripts;
    log('Done!');
    if (!noVM) {
      template = removePercentSection(template, 'no-vm');
    }
    if (ratio16to9) template = removePercentSection(template, '4-3');
    else template = removePercentSection(template, '16-9');
    if (!progressBar) template = removePercentSection(template, 'loading-progress');
    if (!fullscreen) template = removePercentSection(template, 'fullscreen');
    if (monitorColour) template = template.replace(/\{COLOUR\}/g, () => monitorColour);
    else template = removePercentSection(template, 'monitor-colour');
    if (cloudServer) {
      template = removePercentSection(template, 'cloud-localstorage')
        .replace(/\{CLOUD_HOST\}/g, () => JSON.stringify(cloudServer));
    } else {
      template = removePercentSection(template, 'cloud-ws');
    }
    return template
      .replace(/% \/?[a-z0-9-]+ %/g, '')
      // .replace(/\s*\r?\n\s*/g, '')
      .replace('{TITLE}', () => title)
      .replace('{SCRIPTS}', () => scripts);
  });
}

return downloadAsHTML;
})();
