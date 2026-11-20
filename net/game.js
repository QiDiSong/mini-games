(() => {
  'use strict';
  const {directions, analyze, generate, rotate, encode, decode, solve} = NetEngine;
  const get = id => document.getElementById(id);
  const board = get('board');
  const coordinateNames = ['右', '上', '左', '下'];
  const portClasses = ['right', 'up', 'left', 'down'];
  const presets = [5, 7, 9, 11].flatMap(width => [false, true].map(wrap =>
    ({width, height: width, wrap, unique: true, density: 0})));
  const preset = get('preset');
  presets.forEach(({width, wrap}, i) => preset.add(new Option(
    width + ' × ' + width + (wrap ? ' · 边缘相通' : ''), i)));
  preset.add(new Option('自定义', 'custom'));
  preset.value = '4';

  let puzzle, history, cursor, buttons, lastStatus;
  const state = () => history[cursor];
  const revealOrigin = () => state().revealed ? state().beforeReveal : undefined;
  const initial = p => ({tiles: p.tiles.slice(), locked: Array(p.size).fill(false),
    source: p.center, x: 0, y: 0, revealed: false});
  const notify = message => { get('message').textContent = message; };
  const makeSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(2)),
    value => value.toString(36)).join('-');
  const mod = (n, size) => (n % size + size) % size;
  function config() {
    if (preset.value !== 'custom') return presets[Number(preset.value)];
    const density = get('density').valueAsNumber / 100;
    if (!(density >= 0 && density <= 1)) throw new Error('挡板比例须为 0 到 100。');
    return {width: get('width').valueAsNumber, height: get('height').valueAsNumber,
      wrap: get('wrap').checked, unique: get('unique').checked, density};
  }

  function showConfig(p) {
    const index = presets.findIndex(o => Object.keys(o).every(key => o[key] === p[key]));
    preset.value = index < 0 ? 'custom' : String(index);
    get('custom').hidden = index >= 0;
    for (const key of ['width', 'height']) get(key).value = p[key];
    for (const key of ['wrap', 'unique']) get(key).checked = p[key];
    get('density').value = p.density * 100;
  }

  function build(p, saved) {
    puzzle = p;
    history = saved ? [initial(p), saved] : [initial(p)];
    cursor = history.length - 1;
    showConfig(p);
    get('gameID').value = encode(p);
    get('seed').value = p.seed ?? '';
    board.style.gridTemplateColumns = 'repeat(' + p.width + ', minmax(0, 1fr))';
    board.style.setProperty('--board-min', p.width * 26 + 'px');
    buttons = Array.from({length: p.size}, (_, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.cell = i;
      tile.tabIndex = i === p.center ? 0 : -1;
      return tile;
    });
    board.replaceChildren(...buttons);
    notify('');
    render();
  }

  function visibleCell(index) {
    const {x, y} = state();
    return mod(Math.floor(index / puzzle.width) + y, puzzle.height) * puzzle.width +
      mod(index % puzzle.width + x, puzzle.width);
  }
  function span(className) {
    const element = document.createElement('span');
    element.className = className;
    return element;
  }
  function render() {
    const {tiles, locked, source, revealed} = state();
    lastStatus = analyze(puzzle, tiles, source);
    const {active, loops, won} = lastStatus;
    const marked = get('lockedLoops').checked ?
      analyze(puzzle, tiles.map((tile, i) => locked[i] ? tile : 0), source).loops : loops;
    buttons.forEach((button, position) => {
      const i = visibleCell(position);
      const live = active.has(i);
      button.className = 'tile' + (live ? ' active' : '') + (locked[i] ? ' locked' : '');
      const parts = [];
      const rotor = button.querySelector('.rotor') ?? span('rotor');
      const wires = [];
      const ports = [];
      directions.forEach((d, k) => {
        if (tiles[i] & d) {
          ports.push(coordinateNames[k]);
          wires.push(span('port ' + portClasses[k] + (marked[i] & d ? ' error' : '')));
        }
        if (puzzle.barriers[i] & d) parts.push(span('stop ' + portClasses[k]));
      });
      wires.push(span('node' + (source === i ? ' source' : '')));
      rotor.replaceChildren(...wires);
      parts.unshift(rotor);
      button.replaceChildren(...parts);
      const y = Math.floor(position / puzzle.width) + 1;
      const x = position % puzzle.width + 1;
      button.setAttribute('aria-label', y + ' 行 ' + x + ' 列，接口' + ports.join('、') +
        (live ? '，通电' : '') + (source === i ? '，电源' : '') + (locked[i] ? '，已锁定' : ''));
    });
    get('progress').textContent = won ? (revealed ? '已揭晓答案' : '全部接通') + ' · ' +
      puzzle.size + '/' + puzzle.size : '通电 ' + active.size + '/' + puzzle.size;
    const canReturn = revealOrigin() !== undefined;
    get('solve').textContent = canReturn ? '回到揭晓前' : '揭晓答案';
    get('solve').disabled = won && !canReturn;
    get('undo').disabled = cursor === 0;
    get('redo').disabled = cursor + 1 === history.length;
  }
  function record(changes) {
    history.splice(cursor + 1, Infinity, {...state(), ...changes});
    cursor++;
    notify('');
    render();
  }
  function turn(position, action) {
    const i = visibleCell(position);
    if (action === 'lock') {
      const locked = state().locked.slice();
      locked[i] = !locked[i];
      record({locked});
    } else if (!state().locked[i]) {
      const tiles = state().tiles.slice();
      const next = rotate(tiles[i], Number(action));
      if (next !== tiles[i]) {
        tiles[i] = next;
        const rotor = buttons[position].querySelector('.rotor');
        const transform = getComputedStyle(rotor).transform;
        const matrix = new DOMMatrix(transform === 'none' ? undefined : transform);
        const previousAngle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        rotor.getAnimations().forEach(animation => animation.cancel());
        record({tiles, revealed: false});
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          rotor.animate([
            {transform: 'rotate(' + (previousAngle - 90 * Number(action)) + 'deg)'}, {transform: 'rotate(0deg)'},
          ], {duration: 155, easing: 'cubic-bezier(.2,.65,.35,1)'});
        }
      }
    }
  }
  function changeCursor(next) {
    if (next < 0 || next >= history.length) return;
    cursor = next;
    notify('');
    render();
  }
  function report(action) {
    try { return action(); }
    catch (error) { notify(error.message); }
  }
  async function newGame(settings, seed) {
    get('new').disabled = get('seedNew').disabled = true;
    notify('正在生成关卡…');
    await new Promise(resolve => setTimeout(resolve, 30));
    try { build(generate(settings, seed)); }
    catch (error) { notify(error.message); }
    finally { get('new').disabled = get('seedNew').disabled = false; }
  }
  function seedID(settings, seed) {
    const {width, height, wrap, unique, density} = settings;
    return [width, height, Number(wrap), Number(unique), density, seed].join(',');
  }
  function parseSeed(value) {
    const parts = value.split(',');
    const [width, height, wrap, unique, density] = parts.splice(0, 5);
    const seed = parts.join(',');
    if (!seed || !['0', '1'].includes(wrap) || !['0', '1'].includes(unique) ||
        density === '' || !(Number(density) >= 0 && Number(density) <= 1)) {
      throw new Error('种子链接格式无效。');
    }
    return [{width: Number(width), height: Number(height), wrap: wrap === '1',
      unique: unique === '1', density: Number(density)}, seed];
  }
  async function share(key, value) {
    if (!value) { notify('请先用随机种子生成关卡。'); return; }
    const url = new URL(location.href);
    url.hash = key + '=' + encodeURIComponent(value);
    try {
      if (url.protocol === 'file:') throw new Error('local');
      await navigator.clipboard.writeText(url.href);
      notify('已复制链接。');
    } catch {
      window.prompt('复制链接。本地文件链接需要在同一路径打开。', url.href);
    }
  }
  function visitCell(e, action) {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    e.preventDefault();
    const i = Number(cell.dataset.cell);
    for (const button of buttons) button.tabIndex = button === cell ? 0 : -1;
    turn(i, action);
  }

  board.addEventListener('click', e => visitCell(e, e.shiftKey ? 'lock' : get('mode').value));
  board.addEventListener('contextmenu', e => visitCell(e, 1));
  board.addEventListener('auxclick', e => { if (e.button === 1) visitCell(e, 'lock'); });
  board.addEventListener('keydown', e => {
    const cell = e.target.closest('[data-cell]');
    if (!cell) return;
    const p = Number(cell.dataset.cell);
    const arrows = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
    const step = arrows[e.key];
    const key = e.key.toLowerCase();
    if (step) {
      e.preventDefault();
      const {width, height} = puzzle;
      const [dx, dy] = step;
      if (e.shiftKey && puzzle.wrap) {
        record({x: mod(state().x - dx, width), y: mod(state().y - dy, height)});
        return;
      }
      if (e.ctrlKey) {
        const i = state().source;
        const k = dx ? (dx > 0 ? 0 : 2) : (dy > 0 ? 3 : 1);
        const j = puzzle.neighbors[i][k];
        if (j >= 0) record({source: j});
        return;
      }
      const x = p % width + dx, y = Math.floor(p / width) + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      cell.tabIndex = -1;
      const target = buttons[y * width + x];
      target.tabIndex = 0;
      target.focus();
    } else if (['a', 'd', 'f', 's'].includes(key)) {
      e.preventDefault();
      turn(p, {a: -1, d: 1, f: 2, s: 'lock'}[key]);
    } else if (key === 'j') {
      e.preventDefault();
      const random = crypto.getRandomValues(new Uint8Array(puzzle.size));
      record({tiles: state().tiles.map((tile, i) => state().locked[i] ? tile : rotate(tile, random[i] % 4)),
        revealed: false});
    }
  });

  preset.onchange = () => { get('custom').hidden = preset.value !== 'custom'; };
  get('new').onclick = () => report(() => newGame(config(), makeSeed()));
  get('undo').onclick = () => changeCursor(cursor - 1);
  get('redo').onclick = () => changeCursor(cursor + 1);
  get('restart').onclick = () => record(initial(puzzle));
  get('solve').onclick = () => report(() => {
    const origin = revealOrigin();
    if (origin !== undefined) return changeCursor(origin);
    if (lastStatus.won) return;
    const result = puzzle.solution ? {solution: puzzle.solution} : solve(puzzle);
    if (!result.solution) throw new Error(result.exhausted ? '求解达到搜索上限。' : '这道关卡无解。');
    record({tiles: result.solution.slice(), revealed: true, beforeReveal: cursor});
  });
  get('lockedLoops').onchange = render;
  get('import').onclick = () => report(() => build(decode(get('gameID').value)));
  get('seedNew').onclick = () => report(() => newGame(config(), get('seed').value || makeSeed()));
  get('shareID').onclick = () => share('id', encode(puzzle));
  get('shareSeed').onclick = () => share('seed', puzzle.seed && seedID(puzzle, puzzle.seed));
  get('save').onclick = () => {
    const saved = {...state(), beforeReveal: undefined};
    const blob = new Blob([JSON.stringify({version: 1, id: encode(puzzle), state: saved})],
      {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'net-save.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  get('load').onclick = () => get('file').click();
  get('file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('存档文件过大。');
      const entry = JSON.parse(await file.text());
      const p = decode(entry.id);
      const saved = entry.state;
      const validTile = (tile, i) => [0, 1, 2, 3].some(turns => rotate(p.tiles[i], turns) === tile);
      if (entry.version !== 1 || !Array.isArray(saved?.tiles) || !Array.isArray(saved.locked) ||
          saved.tiles.length !== p.size || !saved.tiles.every(validTile) ||
          saved.locked.length !== p.size || !saved.locked.every(value => typeof value === 'boolean') ||
          !Number.isInteger(saved.source) || saved.source < 0 || saved.source >= p.size ||
          ![saved.x, saved.y].every(Number.isInteger)) throw new Error('存档格式无效。');
      build(p, {...saved, revealed: saved.revealed === true, beforeReveal: undefined});
    } catch (error) { notify(error.message); }
  };

  try {
    const fragment = location.hash.slice(1);
    if (fragment.startsWith('id=')) build(decode(decodeURIComponent(fragment.slice(3))));
    else if (fragment.startsWith('seed=')) build(generate(...parseSeed(decodeURIComponent(fragment.slice(5)))));
    else if (fragment) build(decode(decodeURIComponent(fragment)));
    else build(generate(config(), makeSeed()));
  } catch (error) {
    build(generate(presets[0], 'net-default'));
    notify(error.message);
  }
})();
