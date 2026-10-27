/* IndexedDB 封装：训练记录 */
(function (g) {
  'use strict';
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('holdrep', 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('startedAt', 'startedAt');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('sessions', mode);
      const req = fn(t.objectStore('sessions'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  g.HR_DB = {
    add: s => tx('readwrite', st => st.add(s)),
    remove: id => tx('readwrite', st => st.delete(id)),
    get: id => tx('readonly', st => st.get(id)),
    // 时间倒序
    all: async () => (await tx('readonly', st => st.getAll())).sort((a, b) => b.startedAt - a.startedAt),
  };
})(window);
