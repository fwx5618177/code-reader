// ================================
// QuickInput 录音资源释放测试：弹窗关闭或卸载时停止录音器与全部麦克风音轨，
// 关闭后才到达的麦克风授权与录音结果不会生成附件
// MediaRecorder / getUserMedia 以假实现替代
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickInput from '..';

// jsdom 不支持 Canvas / Web Audio，波形绘制与本测试无关
vi.mock('../useRecordingWaveform', () => ({ useRecordingWaveform: () => undefined }));

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
}

function createStream(): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/** 停止后异步触发 onstop，与浏览器行为一致 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  state: RecordingState = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    setTimeout(() => this.onstop?.(), 0);
  });

  constructor(readonly stream: MediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }
}

const getUserMedia = vi.fn<[MediaStreamConstraints], Promise<MediaStream>>();

const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function renderQuickInput(isOpen: boolean) {
  const props = { onClose: vi.fn(), onSubmit: vi.fn() };
  const result = render(<QuickInput isOpen={isOpen} initialMode="text" {...props} />);
  return {
    ...result,
    setOpen: (open: boolean) => result.rerender(<QuickInput isOpen={open} initialMode="text" {...props} />),
  };
}

async function startRecording(): Promise<void> {
  fireEvent.click(screen.getByText('语音'));
  fireEvent.click(screen.getByText('点击开始录音'));
  await flush();
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  getUserMedia.mockReset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

describe('QuickInput 录音', () => {
  it('正常停止录音后生成录音附件并释放麦克风', async () => {
    const { stream, track } = createStream();
    getUserMedia.mockResolvedValue(stream);
    renderQuickInput(true);

    await startRecording();
    fireEvent.click(screen.getByText('停止录音'));
    await flush();

    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByText(/^recording-\d+\.webm$/)).toBeTruthy();
  });

  it('录音文字标注使用实际录音时长', async () => {
    const { stream } = createStream();
    getUserMedia.mockResolvedValue(stream);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const onSubmit = vi.fn();
    render(<QuickInput isOpen initialMode="text" onClose={vi.fn()} onSubmit={onSubmit} />);

    await startRecording();
    nowSpy.mockReturnValue(1_000_000 + 65_000);
    fireEvent.click(screen.getByText('停止录音'));
    await flush();
    nowSpy.mockRestore();

    fireEvent.click(screen.getByText('保存'));
    await flush();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: '[语音录音 01:05]' }));
  });

  it('录音中关闭弹窗：停止录音器与音轨，重新打开后没有残留的录音附件', async () => {
    const { stream, track } = createStream();
    getUserMedia.mockResolvedValue(stream);
    const { setOpen } = renderQuickInput(true);

    await startRecording();
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.state).toBe('recording');

    setOpen(false);
    expect(recorder.stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();

    // 关闭后才触发的 onstop 不得生成附件
    await flush();
    setOpen(true);
    expect(screen.queryByText(/^recording-\d+\.webm$/)).toBeNull();
  });

  it('录音中卸载组件：停止录音器与音轨', async () => {
    const { stream, track } = createStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = renderQuickInput(true);

    await startRecording();
    unmount();

    expect(FakeMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('等待麦克风授权期间关闭弹窗：授权结果到达后立即释放，不开始录音', async () => {
    const { stream, track } = createStream();
    let grant: (stream: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)));
    const { setOpen } = renderQuickInput(true);

    fireEvent.click(screen.getByText('语音'));
    fireEvent.click(screen.getByText('点击开始录音'));
    setOpen(false);
    await act(async () => grant(stream));

    expect(track.stop).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('以语音模式打开后、自动开始录音之前关闭：不再请求麦克风', async () => {
    vi.useFakeTimers();
    try {
      const props = { onClose: vi.fn(), onSubmit: vi.fn() };
      const { rerender } = render(<QuickInput isOpen initialMode="voice" {...props} />);
      rerender(<QuickInput isOpen={false} initialMode="voice" {...props} />);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
