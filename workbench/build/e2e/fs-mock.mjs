/* 注入到页面的假 FileSystemDirectoryHandle。

   为什么必须换掉旧桩：旧桩的 queryPermission / requestPermission 一律返回 'granted'，
   于是「只读目录」「权限被拒」「盘根被拦」这些分支在自动化里永远走不到，
   权限相关的 bug 因此一路活到了用户手上。本桩让每条权限路径都可被真正执行到。

   三条贴近真实浏览器的行为，缺一条测试就是假的：
   ① requestPermission 在没有用户手势时直接 reject（NotAllowedError），而不是返回 granted。
   ② 只读句柄上 getFileHandle({create:true}) 与 createWritable 必须抛 NotAllowedError，
      这才让「保存时争取写权限」这条路径有被测到的意义。
   ③ 遍历全部调用序列到 window.__FS__.log，这是唯一能证明
      「没有二次弹窗」「启动路径不调 requestPermission」的手段。

   还有一条容易被忽略的真实行为：FileSystemHandle 能被 IndexedDB 结构化克隆
   （方法都在原型上，克隆只抄数据字段）。本桩的方法挂在对象自身，
   一进 IndexedDB 就抛 DataCloneError，「刷新后恢复句柄」这条链路根本走不到。
   文件末尾的两段代码只补这一层：克隆出去的是纯数据影子，读回来时按名字换回真身。
   被测的 idbOpen / idbTx / idbPut / idbGet 依然是页面里那段真实实现。 */

/* read / write = queryPermission 的返回（浏览器记住的持久状态）
   grant        = requestPermission 的返回（用户在弹窗里点同意或拒绝的结果）
   两者必须分开，且请求成功后 query 要跟着变：刷新后 query 是 prompt，
   用户点一次续期后 request 返回 granted，此后再 query 也必须是 granted。
   少了这层状态，桩就会演出「续期成功但界面仍显示需续期」这种假象，
   据此得出的结论也不作数。 */
const STRATS = {
  /* 只读目录：读已授权，写从未授予 */
  'read':        { read: 'granted', write: 'prompt',  grant: { read:'granted', write:'granted' } },
  /* 读写俱全 */
  'write':       { read: 'granted', write: 'granted', grant: { read:'granted', write:'granted' } },
  /* 刷新后常态：权限被浏览器收回，但点一次续期能拿回 */
  'prompt':      { read: 'prompt',  write: 'prompt',  grant: { read:'granted', write:'granted' } },
  /* 连读都被拦，弹窗请求也照拒 */
  'denied':      { read: 'denied',  write: 'denied',  grant: { read:'denied',  write:'denied' } },
  /* 模拟选择 C:\ 盘根：showDirectoryPicker 本身抛 SecurityError */
  'blocked-pick':{ pick: 'throw',   read: 'granted', write: 'prompt',  grant: { read:'granted', write:'granted' } },
  /* 只读，但点保存时升级成功 */
  'upgrade-ok':  { read: 'granted', write: 'prompt',  grant: { read:'granted', write:'granted' } },
  /* 只读，点保存时升级被用户拒绝 */
  'upgrade-deny':{ read: 'granted', write: 'prompt',  grant: { read:'granted', write:'denied' } },
  /* 只读 + 遍历故意变慢（每列一个目录 sleep 18ms），专门用来在测试里稳定捕捉「正在扫描」spinner */
  'slow':        { read: 'granted', write: 'prompt',  grant: { read:'granted', write:'granted' } }
};

export function fsMockSource(plan, treeKind) {
  const strat = STRATS[plan];
  if (!strat) throw new Error('未知权限策略: ' + plan);
  const cfg = JSON.stringify(strat);
  const kind = JSON.stringify(treeKind);
  const planJson = JSON.stringify(plan);

  return `(function(){
  var S = ${cfg};
  var KIND = ${kind};
  var F = window.__FS__ = {
    log: [], writes: [], plan: ${planJson}, upgraded: false, picks: 0, reg: {},
    granted: { read: false, write: false }   /* 用户点过弹窗之后浏览器记住的授权 */
  };
  var SLOW = (KIND === 'slow');   /* slow 策略：遍历变慢，方便测试捕捉 spinner */
  function L(o){ o.t = Date.now(); F.log.push(o); }

  /* 结构化克隆只抄「可枚举的字符串键」，遇到函数值直接抛 DataCloneError。
     把方法与会递归爆开的 _children 全部降为不可枚举，
     句柄进 IndexedDB 时就只剩 kind / name / __reg 三个纯数据字段，
     与本桩伪装的真实 FileSystemHandle 行为一致。 */
  function hide(o){
    Object.keys(o).forEach(function(k){
      if (typeof o[k] === 'function' || k === '_children') {
        Object.defineProperty(o, k, {
          enumerable: false, configurable: true, writable: true, value: o[k]
        });
      }
    });
    return o;
  }
  function gesture(){
    try { return !!(navigator.userActivation && navigator.userActivation.isActive); }
    catch(e){ return false; }
  }

  function mkFile(name, body){
    return hide({
      kind: 'file', name: name,
      async getFile(){ return { name: name, size: body.length, lastModified: 1750000000000, text: async function(){ return body; } }; },
      async queryPermission(o){
        var m = (o && o.mode === 'readwrite') ? 'write' : 'read';
        return F.granted[m] ? 'granted' : S[m];
      },
      async requestPermission(o){
        var m = (o && o.mode === 'readwrite') ? 'write' : 'read';
        if(!gesture()){
          L({ op:'request', mode:o && o.mode, gesture:false });
          throw new DOMException('no gesture', 'NotAllowedError');
        }
        var r = (S.grant && S.grant[m]) ? S.grant[m] : 'prompt';
        if(r === 'granted') F.granted[m] = true;
        L({ op:'request', mode:o && o.mode, gesture:true, result:r });
        return r;
      },
      /* 写权限没拿到时抛 NotAllowedError，与真实浏览器一致 */
      async createWritable(){
        var ok = F.granted.write || S.write === 'granted';
        L({ op:'createWritable', ok: ok });
        if(!ok) throw new DOMException('no write permission', 'NotAllowedError');
        var buf = '';
        var self = this;
        return {
          async write(v){ buf += v; },
          async close(){ F.writes.push({ name: self.name, len: buf.length, body: buf }); }
        };
      }
    });
  }

  function mkDir(name, children){
    var map = {};
    (children || []).forEach(function(c){ map[c.name] = c; });
    var h = hide({
      kind: 'directory', name: name, _children: children || [], __reg: name,
      async *entries(){ for (var i = 0; i < h._children.length; i++){ if(SLOW) await new Promise(function(r){ setTimeout(r, 18); }); yield [h._children[i].name, h._children[i]]; } },
      async *values(){ for (var i = 0; i < h._children.length; i++) yield h._children[i]; },
      async getDirectoryHandle(n){
        var c = map[n];
        if(!c || c.kind !== 'directory') throw new DOMException('not a directory: ' + n, 'NotFoundError');
        return c;
      },
      async getFileHandle(n, opt){
        var c = map[n];
        if(!c){
          if(opt && opt.create) return mkFile(n, '');
          throw new DOMException('not found: ' + n, 'NotFoundError');
        }
        if(c.kind !== 'file') throw new DOMException('is a directory: ' + n, 'TypeError');
        return c;
      },
      async queryPermission(o){
        var m = (o && o.mode === 'readwrite') ? 'write' : 'read';
        /* 用户已经点过弹窗并同意过，就再也不会回到 prompt —— 与真实浏览器一致 */
        var r = F.granted[m] ? 'granted' : S[m];
        L({ op:'query', mode:o && o.mode, result:r });
        return r;
      },
      async requestPermission(o){
        var m = (o && o.mode === 'readwrite') ? 'write' : 'read';
        var g = gesture();
        if(!g){
          L({ op:'request', mode:o && o.mode, gesture:false });
          throw new DOMException('no gesture', 'NotAllowedError');
        }
        var r = (S.grant && S.grant[m]) ? S.grant[m] : 'prompt';
        if(r === 'granted'){ F.granted[m] = true; if(m === 'write') F.upgraded = true; }
        L({ op:'request', mode:o && o.mode, gesture:true, result:r });
        return r;
      }
    });
    /* 只有目录句柄会被持久化（见 idbPut(SCAN_ROOT_KEY, h)），
       三棵测试树里目录名唯一，按名字注册即可。 */
    F.reg[name] = h;
    return h;
  }

  function f(name, body){ return mkFile(name, body === undefined ? 'x' : body); }
  function d(name, children){ return mkDir(name, children); }

  var ROOT;
  if (KIND === 'deep') {
    /* 项目埋在第 6 层：普通扫描（4 层）够不到，深度扫描（6 层）才够得到 */
    ROOT = d('DeepRoot', [
      d('l1', [ d('l2', [ d('l3', [ d('l4', [ d('l5', [
        d('deep-proj', [ f('package.json', '{"name":"deep-proj"}'), d('.git', [ f('HEAD', 'ref') ]) ])
      ]) ]) ]) ]) ])
    ]);
  } else if (KIND === 'bigproj') {
    /* 单个大项目：src 下 600 个文件，必然超过 EXACT_MEASURE(400) 触发采样外推。
       用来区分「体积是估算的」与「扫描被截断」——这两个不是一回事，
       混在一起会让每个中等项目都被标成「结果可能不完整」。 */
    var subs = [];
    for (var k = 0; k < 20; k++) {
      var one = [];
      for (var m = 0; m < 30; m++) one.push(f('m' + k + '_' + m + '.ts', 'xxxxxxxxxx'));
      subs.push(d('src' + k, one));
    }
    ROOT = d('BigProjRoot', [
      d('big-app', [ f('package.json', '{"name":"big-app"}') ].concat(subs))
    ]);
  } else if (KIND === 'huge') {
    /* 100 个顶层目录 × 100 个子目录：浅层就把遍历预算吃光 */
    var tops = [];
    for (var i = 0; i < 100; i++) {
      var subs = [];
      for (var j = 0; j < 100; j++) subs.push(d('s' + i + '_' + j, [ f('n.txt', 'x') ]));
      tops.push(d('d' + i, subs));
    }
    tops.push(d('zz-late', [ f('package.json', '{"name":"zz-late"}') ]));
    ROOT = d('BigDrive', tops);
  } else if (KIND === 'slow') {
    /* 90 个顶层目录：配合 SLOW=18ms，遍历约 1.6s，足够测试稳定捕捉「正在扫描」spinner */
    var slowTops = [];
    for (var si = 0; si < 90; si++) slowTops.push(d('proj' + si, [ f('package.json', '{"name":"proj' + si + '"}') ]));
    ROOT = d('SlowRoot', slowTops);
  } else {
    ROOT = d('MyProjects', [
      d('smart-car', [ f('README.md', '# 智能小车\\n\\n基于 STM32F103 的两轮差速小车。\\n'),
                       f('CMakeLists.txt', 'project(smart_car)\\n'),
                       d('src', [ f('main.c', 'int main(){return 0;}\\n') ]),
                       d('.git', [ f('HEAD', 'ref: refs/heads/main\\n') ]) ]),
      d('web-dash', [ f('package.json', '{"scripts":{"dev":"vite --port 5173"}}'),
                      f('README.md', '# 数据看板\\n\\nVite + Vue3 轻量看板。\\n') ]),
      d('scratch', [ f('notes.txt', 'hello\\n') ]),
      d('node_modules', [ d('junk', [ f('package.json', '{}') ]) ])
    ]);
  }

  window.showDirectoryPicker = async function(opt){
    F.picks++;
    L({ op:'pick', mode: opt && opt.mode, gesture: gesture() });
    if (S.pick === 'throw') {
      /* 真实浏览器在 C:\\ 这类位置上的行为：让用户选完目录，才在返回句柄前抛 SecurityError */
      throw new DOMException('Write permission denied', 'SecurityError');
    }
    return ROOT;
  };
  window.__FS_TREE_NAME = ROOT.name;
  window.__wtStubReady = true;

  /* 克隆出去的只是 {kind, name, __reg} 三个纯数据字段，读回来必须换回带方法的真身，
     否则 restoreScanRoot 拿到的是个空壳，扫描必废。
     只拦截 IDBObjectStore.get 的 result 取值：写入走的是真实克隆路径，
     idbOpen / idbTx / idbPut / idbGet 本身也全是页面里那段真实实现。 */
  var origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(k){
    var rq;
    try { rq = origGet.call(this, k); }
    catch(e){ throw e; }
    return new Proxy(rq, {
      get: function(t, p){
        if (p === 'result') {
          var v;
          try { v = t.result; } catch(e){ return undefined; }
          return (v && v.__reg && F.reg[v.__reg]) ? F.reg[v.__reg] : v;
        }
        var m = t[p];
        return typeof m === 'function' ? function(){ return m.apply(t, arguments); } : m;
      },
      set: function(t, p, v){ t[p] = v; return true; }
    });
  };
})();`;
}

/* 兼容模式用：在页面里构造带 webkitRelativePath 的 File 并塞进 input，
   用来验证 scanFlatList 的路径切分与目录树重建（不需要真的点系统选择框）。

   两个必须避开的坑，否则测出来的耗时与结论都是桩自己的：
   ① 清单不能全是 .txt。项目识别规则是「命中 .git 或任一工程标记文件」，
      全是 .txt 时一个项目都不该被识别出来，那样 M12b 就成了同义反复。
      这里每 10 个项目放一个 package.json，其余放 README.md（非标记文件）。
   ② 不能用 DataTransfer.items.add 逐条加。它每加一个文件都要走一次浏览器内部快照，
      6 万条能把耗时推到 20 秒以上。直接把数组挂到 input.files 上即可：
      数组本身就是 array-like 且可迭代，页面的 for..of 与 .length 照常可用。 */
export const FLAT_FILES_HELPER = `
window.__mkFlatFiles = function(count, rootName, cb){
  var list = [], i = 0;
  function step(){
    var end = Math.min(i + 4000, count);
    for (; i < end; i++) {
      var p = Math.floor(i / 150);
      var inP = i % 150;
      /* 路径必须唯一：页面的清单索引以相对路径为键，重名文件会被去重，
         那样 M12d 看到的就不是 6 万条，而是桩自己造出来的假数字 */
      var rel = inP === 0
        ? rootName + '/p' + p + '/' + (p % 10 === 0 ? 'package.json' : 'README.md')
        : rootName + '/p' + p + '/src/file' + inP + '.txt';
      var blob = new File(['x'], rel.slice(rel.lastIndexOf('/') + 1));
      try { Object.defineProperty(blob, 'webkitRelativePath', { value: rel }); }
      catch(e){ /* 少数环境不允许覆写，退化到 name */ }
      list.push(blob);
    }
    if (i < count) { setTimeout(step, 0); return; }
    cb(list);
  }
  /* 分片构造：一次性 new 六万个 File 同样会冻结主线程，那也是桩自己造成的 */
  setTimeout(step, 0);
};
window.__fireFlat = function(files){
  var inp = document.getElementById('dirFlatInput');
  if (!inp) return 'NO_INPUT';
  Object.defineProperty(inp, 'files', { value: files, configurable: true });
  inp.dispatchEvent(new Event('change'));
  return 'OK';
};
window.__HB = 0;
setInterval(function(){ window.__HB++; }, 16);
`;
