export type ChannelAdapter = {
  id: string;
  displayName: string;
  sendMessage(input: {
    threadId: string;
    content: string;
  }): Promise<void>;
};

export type RuntimeAdapter = {
  id: string;
  displayName: string;
  startRun(input: {
    workstreamId: string;
    cwd: string;
    prompt: string;
  }): Promise<{
    runId: string;
  }>;
};
