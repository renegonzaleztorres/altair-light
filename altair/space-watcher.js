/**
 * Active-space watcher with batched events and optional snapshot reconciliation.
 */

import { fs, fsSync, path } from './dependencies.js';

class SpaceWatcher {

  constructor({
    rootPath,
    quietMs = 250,
    maxBatchMs = 2000,
    reconcileEnabled = false,
    reconcileMs = 30000,
    ignoredPaths = [],
    onDirty = null,
    onBatch = null,
    onUncertain = null,
    readoutCallback = null
  } = {}) {
    this.rootPath = rootPath;
    this.quietMs = quietMs;
    this.maxBatchMs = maxBatchMs;
    this.reconcileEnabled = reconcileEnabled === true;
    this.reconcileMs = reconcileMs;
    this.ignoredPaths = new Set(ignoredPaths.map((item) => this.normalizeRelativePath(item)));
    this.onDirty = typeof onDirty === 'function' ? onDirty : () => {};
    this.onBatch = typeof onBatch === 'function' ? onBatch : async () => true;
    this.onUncertain = typeof onUncertain === 'function' ? onUncertain : () => {};
    this.readout = typeof readoutCallback === 'function' ? readoutCallback : () => {};

    this.watcher = null;
    this.snapshot = null;
    this.pendingPaths = new Set();
    this.dirty = false;
    this.uncertain = false;
    this.processing = false;
    this.closed = false;
    this.quietTimer = null;
    this.maxBatchTimer = null;
    this.reconcileTimer = null;
    this.recoveryTimer = null;
  }

  normalizeRelativePath(value = '') {
    return String(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  isIgnored(relativePath) {
    const normalized = this.normalizeRelativePath(relativePath);
    for (const ignoredPath of this.ignoredPaths) {
      if (normalized === ignoredPath || normalized.startsWith(`${ignoredPath}/`)) return true;
    }
    return false;
  }

  async buildSnapshot() {
    const resolvedRootPath = await fs.realpath(this.rootPath);
    const files = new Map();

    const visit = async (directoryPath, relativeDirectory = '') => {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = this.normalizeRelativePath(path.join(relativeDirectory, entry.name));
        if (this.isIgnored(relativePath)) continue;

        const absolutePath = path.join(directoryPath, entry.name);
        const stats = await fs.lstat(absolutePath);
        const type = stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file';
        files.set(relativePath, {
          size: stats.size,
          modifiedTimeMs: stats.mtimeMs,
          ino: stats.ino,
          type
        });

        if (stats.isDirectory()) await visit(absolutePath, relativePath);
      }
    };

    await visit(this.rootPath);
    return { resolvedRootPath, files };
  }

  snapshotsDiffer(previous, current) {
    if (!previous || previous.resolvedRootPath !== current.resolvedRootPath) return true;
    if (previous.files.size !== current.files.size) return true;

    for (const [relativePath, value] of current.files) {
      const oldValue = previous.files.get(relativePath);
      if (!oldValue || oldValue.size !== value.size ||
          oldValue.modifiedTimeMs !== value.modifiedTimeMs ||
          oldValue.ino !== value.ino || oldValue.type !== value.type) return true;
    }
    return false;
  }

  async start() {
    if (this.closed) return false;
    this.snapshot = await this.buildSnapshot();
    try {
      this.attachNativeWatcher();
    } catch (error) {
      await this.handleUncertain('watcher-start-error', error);
    }

    if (this.reconcileEnabled) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcile();
      }, this.reconcileMs);
    }

    this.readout(
      `Watching active space: ${this.rootPath}; reconciliation=${this.reconcileEnabled}`,
      'Space-Watch'
    );
    return true;
  }

  attachNativeWatcher() {
    if (this.closed) return;
    if (this.watcher) this.watcher.close();

    this.watcher = fsSync.watch(this.rootPath, { recursive: true }, (eventType, fileName) => {
      if (this.closed) return;
      const relativePath = this.normalizeRelativePath(fileName || '');
      if (relativePath && this.isIgnored(relativePath)) return;
      this.markDirty(relativePath || '.', eventType);
    });

    this.watcher.on('error', (error) => {
      if (this.closed) return;
      void this.handleUncertain('watcher-error', error);
    });
  }

  markDirty(relativePath, reason = 'change') {
    if (this.closed) return;
    this.pendingPaths.add(this.normalizeRelativePath(relativePath));
    if (!this.dirty) {
      this.dirty = true;
      this.onDirty({ reason });
      this.maxBatchTimer = setTimeout(() => void this.processBatch('maximum-window'), this.maxBatchMs);
    }

    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => void this.processBatch('quiet-window'), this.quietMs);
  }

  async processBatch(reason = 'native-event') {
    if (this.closed || this.processing || !this.dirty) return false;
    this.processing = true;
    this.clearBatchTimers();
    const batchPaths = this.pendingPaths;
    this.pendingPaths = new Set();
    const changedPaths = [...batchPaths].sort();

    try {
      const nextSnapshot = await this.buildSnapshot();
      const rootChanged = Boolean(
        this.snapshot && this.snapshot.resolvedRootPath !== nextSnapshot.resolvedRootPath
      );
      const accepted = await this.onBatch({
        reason,
        changedPaths,
        rootChanged,
        snapshot: nextSnapshot
      });

      if (accepted === false) {
        for (const changedPath of batchPaths) this.pendingPaths.add(changedPath);
        this.uncertain = true;
        this.onUncertain({ reason: 'batch-rejected' });
        return false;
      }

      this.snapshot = nextSnapshot;
      this.dirty = this.pendingPaths.size > 0;
      this.uncertain = false;
      if (rootChanged) this.attachNativeWatcher();
      if (this.dirty) {
        if (!this.quietTimer) {
          this.quietTimer = setTimeout(() => void this.processBatch('quiet-window'), this.quietMs);
        }
        this.maxBatchTimer = setTimeout(() => void this.processBatch('maximum-window'), this.maxBatchMs);
      }
      this.readout(`Accepted change batch (${changedPaths.length} paths)`, 'Space-Watch');
      return true;
    } catch (error) {
      await this.handleUncertain('batch-error', error);
      return false;
    } finally {
      this.processing = false;
    }
  }

  async reconcile() {
    if (this.closed || this.processing || this.dirty) return false;
    try {
      const nextSnapshot = await this.buildSnapshot();
      if (!this.snapshotsDiffer(this.snapshot, nextSnapshot)) return false;
      this.markDirty('.', 'reconciliation-mismatch');
      return await this.processBatch('reconciliation-mismatch');
    } catch (error) {
      await this.handleUncertain('reconciliation-error', error);
      return false;
    }
  }

  async rescan(reason = 'explicit-rescan') {
    if (this.closed) return false;
    try {
      const nextSnapshot = await this.buildSnapshot();
      const changed = this.snapshotsDiffer(this.snapshot, nextSnapshot);
      this.snapshot = nextSnapshot;
      this.pendingPaths.clear();
      this.dirty = false;
      this.uncertain = false;
      this.clearBatchTimers();
      this.readout(`Snapshot refreshed (${reason}, ${nextSnapshot.files.size} paths)`, 'Space-Watch');
      return changed;
    } catch (error) {
      await this.handleUncertain(reason, error);
      return false;
    }
  }

  async reattach(reason = 'explicit-reattach') {
    if (this.closed) return false;
    try {
      this.attachNativeWatcher();
      await this.rescan(reason);
      this.readout(`Watcher reattached (${reason})`, 'Space-Watch');
      return !this.uncertain;
    } catch (error) {
      await this.handleUncertain(reason, error);
      return false;
    }
  }

  async handleUncertain(reason, error) {
    if (this.closed) return;
    this.uncertain = true;
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    this.onUncertain({ reason, error });
    this.readout(`${reason}: ${error?.message || 'unknown watcher error'}`, 'Space-Error');
    if (!this.recoveryTimer) {
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        void this.recover(reason);
      }, this.quietMs);
    }
  }

  async recover(reason) {
    if (this.closed) return false;
    try {
      const nextSnapshot = await this.buildSnapshot();
      const rootChanged = Boolean(
        this.snapshot && this.snapshot.resolvedRootPath !== nextSnapshot.resolvedRootPath
      );
      const accepted = await this.onBatch({
        reason: `recovery-${reason}`,
        changedPaths: ['.'],
        rootChanged,
        snapshot: nextSnapshot
      });
      if (accepted === false || this.closed) {
        if (!this.closed) await this.handleUncertain('watcher-recovery-rejected');
        return false;
      }
      this.snapshot = nextSnapshot;
      this.pendingPaths.clear();
      this.dirty = false;
      this.uncertain = false;
      this.attachNativeWatcher();
      this.readout(`Watcher recovered (${reason})`, 'Space-Watch');
      return true;
    } catch (error) {
      await this.handleUncertain('watcher-recovery-error', error);
      return false;
    }
  }

  clearBatchTimers() {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.maxBatchTimer) clearTimeout(this.maxBatchTimer);
    this.quietTimer = null;
    this.maxBatchTimer = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearBatchTimers();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    this.pendingPaths.clear();
    this.snapshot = null;
  }

}

export default SpaceWatcher;
