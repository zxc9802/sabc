import { describe, expect, it } from "vitest";

import { detectInterviewCommand } from "./interview-command";

describe("detectInterviewCommand", () => {
  it.each(["跳过", "这题跳过", "暂时无法提供"])(
    "recognizes an explicit skip: %s",
    (text) => expect(detectInterviewCommand(text)).toBe("skip"),
  );

  it.each(["结束评估", "完成评估", "生成当前结论"])(
    "recognizes an explicit finish: %s",
    (text) => expect(detectInterviewCommand(text)).toBe("finish"),
  );

  it("ignores sentence-ending punctuation", () => {
    expect(detectInterviewCommand("结束评估。")).toBe("finish");
  });

  it("does not treat an ordinary negative answer as a command", () => {
    expect(
      detectInterviewCommand("目前没有订单，但有 20 个访谈样本"),
    ).toBeNull();
  });
});
