// ================================
// PerformanceMonitor Unit Tests
// Tests for performance metrics collection and reporting
// ================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceMonitor,
  createPerformanceMonitor,
  createDetailedMonitor,
  createLightweightMonitor,
  getDefaultPerformanceMonitor,
  resetDefaultPerformanceMonitor,
  formatReport,
  exportMetricsAsJSON,
  type MetricType,
  type PerformanceMonitorConfig,
} from '../performance-monitor';

// ================================
// Test Suite
// ================================

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetDefaultPerformanceMonitor();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDefaultPerformanceMonitor();
  });

  // ================================
  // Factory Tests
  // ================================

  describe('Factory Functions', () => {
    it('should create a new PerformanceMonitor instance', () => {
      const monitor = createPerformanceMonitor();
      expect(monitor).toBeInstanceOf(PerformanceMonitor);
    });

    it('should create with custom config', () => {
      const config: PerformanceMonitorConfig = {
        enabled: true,
        maxMetrics: 500,
        slowThreshold: 500,
      };
      const monitor = createPerformanceMonitor(config);
      const storedConfig = monitor.getConfig();

      expect(storedConfig.maxMetrics).toBe(500);
      expect(storedConfig.slowThreshold).toBe(500);
    });

    it('should create detailed monitor with high precision settings', () => {
      const monitor = createDetailedMonitor();
      const config = monitor.getConfig();

      expect(config.maxMetrics).toBe(50000);
      expect(config.sampleRate).toBe(1.0);
      expect(config.consoleLog).toBe(true);
    });

    it('should create lightweight monitor with sampling', () => {
      const monitor = createLightweightMonitor();
      const config = monitor.getConfig();

      expect(config.maxMetrics).toBe(1000);
      expect(config.sampleRate).toBe(0.1);
      expect(config.consoleLog).toBe(false);
    });

    it('should return singleton from getDefaultPerformanceMonitor', () => {
      const monitor1 = getDefaultPerformanceMonitor();
      const monitor2 = getDefaultPerformanceMonitor();
      expect(monitor1).toBe(monitor2);
    });

    it('should create new instance after resetDefaultPerformanceMonitor', () => {
      const monitor1 = getDefaultPerformanceMonitor();
      resetDefaultPerformanceMonitor();
      const monitor2 = getDefaultPerformanceMonitor();
      expect(monitor1).not.toBe(monitor2);
    });
  });

  // ================================
  // Timer Tests
  // ================================

  describe('Timer Operations', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should start and end a timer', () => {
      const timerId = monitor.startTimer('diff_compute');
      expect(timerId).not.toBeNull();

      vi.advanceTimersByTime(100);

      const metric = monitor.endTimer(timerId);
      expect(metric).not.toBeNull();
      expect(metric?.type).toBe('diff_compute');
      expect(metric?.duration).toBeGreaterThanOrEqual(100);
    });

    it('should return null for invalid timer ID', () => {
      const metric = monitor.endTimer('invalid-timer');
      expect(metric).toBeNull();
    });

    it('should return null when disabled', () => {
      const disabledMonitor = createPerformanceMonitor({ enabled: false });
      const timerId = disabledMonitor.startTimer('diff_compute');
      expect(timerId).toBeNull();
      disabledMonitor.destroy();
    });

    it('should track input size', () => {
      const timerId = monitor.startTimer('diff_compute', { inputSize: 1024 });
      const metric = monitor.endTimer(timerId);

      expect(metric?.inputSize).toBe(1024);
    });

    it('should track output size', () => {
      const timerId = monitor.startTimer('diff_compute');
      const metric = monitor.endTimer(timerId, { outputSize: 512 });

      expect(metric?.outputSize).toBe(512);
    });

    it('should track metadata', () => {
      const timerId = monitor.startTimer('diff_compute', {
        metadata: { algorithm: 'myers' },
      });
      const metric = monitor.endTimer(timerId, {
        metadata: { optimized: true },
      });

      expect(metric?.metadata).toEqual({ algorithm: 'myers', optimized: true });
    });

    it('should track success status', () => {
      const successTimerId = monitor.startTimer('diff_compute');
      const successMetric = monitor.endTimer(successTimerId, { success: true });
      expect(successMetric?.success).toBe(true);

      const failTimerId = monitor.startTimer('diff_compute');
      const failMetric = monitor.endTimer(failTimerId, { success: false });
      expect(failMetric?.success).toBe(false);
    });

    it('should track active timer count', () => {
      expect(monitor.getActiveTimerCount()).toBe(0);

      const timer1 = monitor.startTimer('diff_compute');
      expect(monitor.getActiveTimerCount()).toBe(1);

      const timer2 = monitor.startTimer('search_query');
      expect(monitor.getActiveTimerCount()).toBe(2);

      monitor.endTimer(timer1);
      expect(monitor.getActiveTimerCount()).toBe(1);

      monitor.endTimer(timer2);
      expect(monitor.getActiveTimerCount()).toBe(0);
    });
  });

  // ================================
  // Measure Tests
  // ================================

  describe('Measure Functions', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should measure async operation', async () => {
      const result = await monitor.measure('diff_compute', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'result';
      });

      expect(result).toBe('result');
      expect(monitor.getMetricCount()).toBe(1);
    });

    it('should measure sync operation', () => {
      const result = monitor.measureSync('hash_compute', () => {
        return 42;
      });

      expect(result).toBe(42);
      expect(monitor.getMetricCount()).toBe(1);
    });

    it('should track failure in async measure', async () => {
      const error = new Error('Test error');

      await expect(
        monitor.measure('diff_compute', async () => {
          throw error;
        })
      ).rejects.toThrow('Test error');

      const metrics = monitor.getMetrics('diff_compute');
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
    });

    it('should track failure in sync measure', () => {
      const error = new Error('Test error');

      expect(() =>
        monitor.measureSync('hash_compute', () => {
          throw error;
        })
      ).toThrow('Test error');

      const metrics = monitor.getMetrics('hash_compute');
      expect(metrics.length).toBe(1);
      expect(metrics[0].success).toBe(false);
    });
  });

  // ================================
  // Metrics Access Tests
  // ================================

  describe('Metrics Access', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });

      // Add some test metrics
      const types: MetricType[] = ['diff_compute', 'search_query', 'diff_compute'];
      types.forEach((type) => {
        const timerId = monitor.startTimer(type);
        vi.advanceTimersByTime(10);
        monitor.endTimer(timerId);
      });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should get all metrics', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.length).toBe(3);
    });

    it('should get metrics by type', () => {
      const diffMetrics = monitor.getMetrics('diff_compute');
      expect(diffMetrics.length).toBe(2);
      diffMetrics.forEach((m) => expect(m.type).toBe('diff_compute'));

      const searchMetrics = monitor.getMetrics('search_query');
      expect(searchMetrics.length).toBe(1);
    });

    it('should get recent metrics', () => {
      const recent = monitor.getRecentMetrics(2);
      expect(recent.length).toBe(2);
    });

    it('should get recent metrics by type', () => {
      const recent = monitor.getRecentMetrics(5, 'diff_compute');
      expect(recent.length).toBe(2);
    });

    it('should get metrics in time range', () => {
      const now = Date.now();
      const metrics = monitor.getMetricsInRange(now - 1000, now + 1000);
      expect(metrics.length).toBe(3);
    });

    it('should return metric count', () => {
      expect(monitor.getMetricCount()).toBe(3);
    });
  });

  // ================================
  // Summary Tests
  // ================================

  describe('Summary Calculation', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });

      // Add metrics with varying durations
      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      durations.forEach((duration) => {
        const timerId = monitor.startTimer('diff_compute', { inputSize: duration * 10 });
        vi.advanceTimersByTime(duration);
        monitor.endTimer(timerId, { outputSize: duration * 5 });
      });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should calculate summary for metric type', () => {
      const summary = monitor.getSummary('diff_compute');

      expect(summary).not.toBeNull();
      expect(summary?.type).toBe('diff_compute');
      expect(summary?.count).toBe(10);
    });

    it('should return null for non-existent type', () => {
      const summary = monitor.getSummary('search_query');
      expect(summary).toBeNull();
    });

    it('should calculate average duration', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.avgDuration).toBeCloseTo(55, 0);
    });

    it('should calculate min and max duration', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.minDuration).toBeGreaterThanOrEqual(10);
      expect(summary?.maxDuration).toBeGreaterThanOrEqual(100);
    });

    it('should calculate percentiles', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.p50).toBeDefined();
      expect(summary?.p90).toBeDefined();
      expect(summary?.p95).toBeDefined();
      expect(summary?.p99).toBeDefined();
    });

    it('should calculate success/failure counts', () => {
      // Add a failed metric
      const timerId = monitor.startTimer('diff_compute');
      monitor.endTimer(timerId, { success: false });

      const summary = monitor.getSummary('diff_compute');
      expect(summary?.successCount).toBe(10);
      expect(summary?.failureCount).toBe(1);
    });

    it('should calculate average input/output sizes', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.avgInputSize).toBeGreaterThan(0);
      expect(summary?.avgOutputSize).toBeGreaterThan(0);
    });

    it('should calculate throughput', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.throughput).toBeGreaterThan(0);
    });

    it('should calculate standard deviation', () => {
      const summary = monitor.getSummary('diff_compute');
      expect(summary?.stdDev).toBeGreaterThan(0);
    });
  });

  // ================================
  // Report Tests
  // ================================

  describe('Report Generation', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });

      // Add some metrics
      const types: MetricType[] = ['diff_compute', 'search_query', 'hash_compute'];
      types.forEach((type) => {
        const timerId = monitor.startTimer(type);
        vi.advanceTimersByTime(50);
        monitor.endTimer(timerId);
      });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should generate report', () => {
      const report = monitor.generateReport();

      expect(report).toBeDefined();
      expect(report.generatedAt).toBeDefined();
      expect(report.timeRange).toBeDefined();
      expect(report.summaries).toBeInstanceOf(Map);
      expect(report.totalOperations).toBe(3);
    });

    it('should include summaries for all types', () => {
      const report = monitor.generateReport();

      expect(report.summaries.size).toBe(3);
      expect(report.summaries.has('diff_compute')).toBe(true);
      expect(report.summaries.has('search_query')).toBe(true);
      expect(report.summaries.has('hash_compute')).toBe(true);
    });

    it('should calculate overall statistics', () => {
      const report = monitor.generateReport();

      expect(report.totalOperations).toBe(3);
      expect(report.totalSuccessful).toBe(3);
      expect(report.successRate).toBe(1);
      expect(report.overallAvgDuration).toBeGreaterThan(0);
    });

    it('should include time range', () => {
      const report = monitor.generateReport();

      expect(report.timeRange.start).toBeDefined();
      expect(report.timeRange.end).toBeDefined();
      expect(report.timeRange.end).toBeGreaterThanOrEqual(report.timeRange.start);
    });
  });

  // ================================
  // Management Tests
  // ================================

  describe('Management Operations', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should clear all metrics', () => {
      const timerId = monitor.startTimer('diff_compute');
      monitor.endTimer(timerId);

      expect(monitor.getMetricCount()).toBe(1);

      monitor.clear();

      expect(monitor.getMetricCount()).toBe(0);
    });

    it('should clear metrics by type', () => {
      const types: MetricType[] = ['diff_compute', 'search_query', 'diff_compute'];
      types.forEach((type) => {
        const timerId = monitor.startTimer(type);
        monitor.endTimer(timerId);
      });

      expect(monitor.getMetricCount()).toBe(3);

      monitor.clearByType('diff_compute');

      expect(monitor.getMetricCount()).toBe(1);
      expect(monitor.getMetrics('diff_compute').length).toBe(0);
    });

    it('should update config', () => {
      const initialConfig = monitor.getConfig();
      expect(initialConfig.slowThreshold).toBe(1000);

      monitor.updateConfig({ slowThreshold: 500 });

      const updatedConfig = monitor.getConfig();
      expect(updatedConfig.slowThreshold).toBe(500);
    });

    it('should destroy and cleanup', () => {
      const timerId = monitor.startTimer('diff_compute');
      monitor.endTimer(timerId);

      monitor.destroy();

      expect(monitor.getMetricCount()).toBe(0);
      expect(monitor.getActiveTimerCount()).toBe(0);
    });
  });

  // ================================
  // Sampling Tests
  // ================================

  describe('Sampling', () => {
    it('should respect sample rate', () => {
      const monitor = createPerformanceMonitor({
        enabled: true,
        sampleRate: 0.5,
        consoleLog: false,
      });

      // Mock Math.random to control sampling
      let callCount = 0;
      const originalRandom = Math.random;
      Math.random = () => {
        callCount++;
        return callCount % 2 === 0 ? 0.3 : 0.7; // Alternating below/above 0.5
      };

      // Start multiple timers
      const timerIds: (string | null)[] = [];
      for (let i = 0; i < 10; i++) {
        timerIds.push(monitor.startTimer('diff_compute'));
      }

      // Restore Math.random
      Math.random = originalRandom;

      // Count non-null timer IDs (those that were sampled)
      const sampledCount = timerIds.filter((id) => id !== null).length;
      expect(sampledCount).toBeLessThan(10);

      monitor.destroy();
    });
  });

  // ================================
  // Max Metrics Tests
  // ================================

  describe('Max Metrics Limit', () => {
    it('should respect maxMetrics limit', () => {
      const monitor = createPerformanceMonitor({
        enabled: true,
        maxMetrics: 5,
        consoleLog: false,
      });

      // Add more than max metrics
      for (let i = 0; i < 10; i++) {
        const timerId = monitor.startTimer('diff_compute');
        monitor.endTimer(timerId);
      }

      expect(monitor.getMetricCount()).toBe(5);

      monitor.destroy();
    });
  });

  // ================================
  // Format and Export Tests
  // ================================

  describe('Format and Export', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = createPerformanceMonitor({ enabled: true, consoleLog: false });

      const timerId = monitor.startTimer('diff_compute', { inputSize: 1024 });
      vi.advanceTimersByTime(100);
      monitor.endTimer(timerId, { outputSize: 512 });
    });

    afterEach(() => {
      monitor.destroy();
    });

    it('should format report as string', () => {
      const report = monitor.generateReport();
      const formatted = formatReport(report);

      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('Performance Report');
      expect(formatted).toContain('diff_compute');
    });

    it('should export metrics as JSON', () => {
      const json = exportMetricsAsJSON(monitor);

      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.totalOperations).toBe(1);
      expect(parsed.summaries).toBeDefined();
    });
  });

  // ================================
  // Slow Operation Detection Tests
  // ================================

  describe('Slow Operation Detection', () => {
    it('should log slow operations when consoleLog is enabled', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const monitor = createPerformanceMonitor({
        enabled: true,
        consoleLog: true,
        slowThreshold: 50,
      });

      const timerId = monitor.startTimer('diff_compute');
      vi.advanceTimersByTime(100); // Exceeds threshold
      monitor.endTimer(timerId);

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Slow operation');

      consoleWarnSpy.mockRestore();
      monitor.destroy();
    });

    it('should not log fast operations', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const monitor = createPerformanceMonitor({
        enabled: true,
        consoleLog: true,
        slowThreshold: 500,
      });

      const timerId = monitor.startTimer('diff_compute');
      vi.advanceTimersByTime(10); // Below threshold
      monitor.endTimer(timerId);

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
      monitor.destroy();
    });
  });
});
