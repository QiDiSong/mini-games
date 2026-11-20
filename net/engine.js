(() => {
  'use strict';
  const directions = [1, 2, 4, 8];
  const opposite = d => ((d << 2) | (d >> 2)) & 15;
  function rotate(mask, turns) {
    const n = (4 - turns % 4) % 4;
    return ((mask << n) | (mask >> (4 - n))) & 15;
  }

  function board(config, tiles, barriers) {
    const {width, height, wrap} = config;
    if (![width, height].every(n => Number.isInteger(n) && n >= 2 && n <= 20)) {
      throw new Error('宽度和高度须为 2 到 20 的整数。');
    }
    const size = width * height;
    const neighbors = Array.from({length: size}, (_, i) => directions.map((_, k) => {
      const x = i % width + [1, 0, -1, 0][k];
      const y = Math.floor(i / width) + [0, -1, 0, 1][k];
      if (!wrap && (x < 0 || x >= width || y < 0 || y >= height)) return -1;
      return ((y + height) % height) * width + (x + width) % width;
    }));
    return {...config, size, neighbors, tiles, barriers: barriers ?? Array(size).fill(0),
      center: Math.floor(height / 2) * width + Math.floor(width / 2)};
  }

  function analyze(puzzle, tiles, source = puzzle.center) {
    const links = tiles.map((mask, i) => directions.flatMap((d, k) => {
      const j = puzzle.neighbors[i][k];
      return j >= 0 && (mask & d) && !(puzzle.barriers[i] & d) &&
        (tiles[j] & opposite(d)) ? [{j, d, id: d <= 2 ? 4 * i + k : 4 * j + k - 2}] : [];
    }));
    const active = new Set([source]);
    for (const i of active) for (const {j} of links[i]) active.add(j);
    const times = Array(tiles.length).fill(0);
    const bridges = new Set();
    let time = 0;
    function visit(i, parentEdge) {
      let low = times[i] = ++time;
      for (const {j, id} of links[i]) {
        if (id === parentEdge) continue;
        if (times[j]) {
          low = Math.min(low, times[j]);
        } else {
          const child = visit(j, id);
          if (child > times[i]) bridges.add(id);
          low = Math.min(low, child);
        }
      }
      return low;
    }
    for (let i = 0; i < tiles.length; i++) if (!times[i]) visit(i, -1);
    const loops = links.map(edges => edges.reduce((mask, edge) =>
      bridges.has(edge.id) ? mask : mask | edge.d, 0));
    const won = active.size === tiles.length && !loops.some(Boolean) &&
      links.every((edges, i) => edges.reduce((mask, edge) => mask | edge.d, 0) === tiles[i]);
    return {active, loops, won};
  }

  function solve(puzzle, limit = 1, budget = 25000) {
    const {tiles, neighbors, barriers, size} = puzzle;
    const domains = tiles.map((mask, i) => {
      const blocked = directions.reduce((m, d, k) => neighbors[i][k] < 0 ? m | d : m, barriers[i]);
      return [...new Set([0, 1, 2, 3].map(n => rotate(mask, n)))].filter(v => !(v & blocked));
    });
    let count = 0;
    let solution;
    let exhausted = false;
    function search(options) {
      if (count >= limit || exhausted) return;
      if (--budget < 0) { exhausted = true; return; }
      const queue = Array.from({length: size}, (_, i) => i);
      const queued = new Set(queue);
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q];
        queued.delete(i);
        if (!options[i].length) return;
        for (let k = 0; k < 4; k++) {
          const j = neighbors[i][k];
          if (j < 0) continue;
          const d = directions[k];
          const back = opposite(d);
          const support = options[i].reduce((state, v) => state | ((v & d) ? 2 : 1), 0);
          const filtered = options[j].filter(v => support & ((v & back) ? 2 : 1));
          if (!filtered.length) return;
          if (filtered.length === options[j].length) continue;
          options[j] = filtered;
          if (!queued.has(j)) { queue.push(j); queued.add(j); }
        }
      }
      let branch = -1;
      for (let i = 0; i < size; i++) {
        if (options[i].length > 1 && (branch < 0 || options[i].length < options[branch].length)) branch = i;
      }
      if (branch < 0) {
        const candidate = options.map(values => values[0]);
        if (analyze(puzzle, candidate).won) { count++; solution ??= candidate; }
        return;
      }
      // A loop using only fixed connections cannot disappear in deeper branches.
      const fixed = options.map(values => values.length === 1 ? values[0] : 0);
      if (analyze(puzzle, fixed).loops.some(Boolean)) return;
      for (const mask of options[branch]) {
        const next = options.slice();
        next[branch] = [mask];
        search(next);
      }
    }
    search(domains);
    return {count, solution, exhausted};
  }

  function seeded(seed) {
    let state = 2166136261;
    for (const char of seed) state = Math.imul(state ^ char.codePointAt(0), 16777619);
    return n => {
      state = (state + 0x6d2b79f5) | 0;
      let x = Math.imul(state ^ (state >>> 15), 1 | state);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return Math.floor(((x ^ (x >>> 14)) >>> 0) / 4294967296 * n);
    };
  }

  function generate(config, seed) {
    const random = seeded(seed);
    const puzzle = board(config);
    if (config.unique && config.wrap && (config.width === 2 || config.height === 2)) {
      throw new Error('环绕棋盘的宽或高为 2 时，请关闭唯一解。');
    }
    const {size, neighbors, center} = puzzle;
    for (let attempt = 0; attempt < 180; attempt++) {
      const solution = Array(size).fill(0);
      const degree = Array(size).fill(0);
      const visited = new Set([center]);
      const frontier = [];
      function add(i) {
        neighbors[i].forEach((j, k) => { if (j >= 0 && !visited.has(j)) frontier.push([i, j, directions[k]]); });
      }
      add(center);
      while (frontier.length) {
        const index = random(frontier.length);
        const [i, j, d] = frontier[index];
        frontier[index] = frontier[frontier.length - 1];
        frontier.pop();
        if (visited.has(j) || degree[i] >= 3) continue;
        visited.add(j);
        degree[i]++;
        degree[j]++;
        solution[i] |= d;
        solution[j] |= opposite(d);
        add(j);
      }
      if (visited.size !== size) continue;
      const barriers = Array(size).fill(0);
      for (let i = 0; i < size; i++) for (const k of [0, 3]) {
        const j = neighbors[i][k], d = directions[k];
        const roll = random(10000);
        if (j >= 0 && !(solution[i] & d) && roll < config.density * 10000) {
          barriers[i] |= d;
          barriers[j] |= opposite(d);
        }
      }
      const candidate = {...puzzle, tiles: solution, barriers};
      if (config.unique) {
        const result = solve(candidate, 2, 3000);
        if (result.exhausted || result.count !== 1) continue;
      }
      let tiles;
      for (let i = 0; i < 35; i++) {
        const shuffled = solution.map(mask => rotate(mask, random(4)));
        const status = analyze(candidate, shuffled);
        if (!status.won && !status.loops.some(Boolean)) { tiles = shuffled; break; }
      }
      if (!tiles) {
        tiles = solution.slice();
        const endpoint = degree.indexOf(1);
        tiles[endpoint] = rotate(tiles[endpoint], 1);
      }
      return {...candidate, tiles, solution, seed};
    }
    throw new Error('未能生成符合当前设置的关卡。请换个种子、增加挡板或缩小棋盘。');
  }

  function encode(puzzle) {
    const {width, height, wrap, tiles, barriers} = puzzle;
    const description = tiles.map((mask, i) =>
      mask.toString(16) + (barriers[i] & 8 ? 'h' : '') + (barriers[i] & 1 ? 'v' : '')).join('');
    return width + 'x' + height + (wrap ? 'w' : '') + ':' + description;
  }

  function decode(id) {
    const match = /^(\d+)x(\d+)(w?):((?:[1-9a-fA-F][hv]*)+)$/.exec(id.trim());
    if (!match) throw new Error('关卡 ID 格式无效。');
    const [, w, h, wrap, description] = match;
    const entries = description.match(/[1-9a-fA-F][hv]*/g);
    const puzzle = board({width: Number(w), height: Number(h), wrap: !!wrap, unique: true, density: 0},
      entries.map(entry => parseInt(entry[0], 16)));
    if (entries.length !== puzzle.size) throw new Error('关卡 ID 的格子数量与尺寸不符。');
    entries.forEach((entry, i) => {
      for (const [marker, k] of [['h', 3], ['v', 0]]) {
        if (!entry.includes(marker)) continue;
        const j = puzzle.neighbors[i][k];
        const d = directions[k];
        if (j >= 0) {
          puzzle.barriers[i] |= d;
          puzzle.barriers[j] |= opposite(d);
        }
      }
    });
    const ports = puzzle.tiles.reduce((n, mask) => n + directions.filter(d => mask & d).length, 0);
    if (ports !== 2 * (puzzle.size - 1)) throw new Error('该关卡 ID 的线路数量无效。');
    return puzzle;
  }

  const engine = {directions, rotate, analyze, solve, generate, encode, decode};
  if (typeof module !== 'undefined') module.exports = engine;
  else globalThis.NetEngine = engine;
})();
