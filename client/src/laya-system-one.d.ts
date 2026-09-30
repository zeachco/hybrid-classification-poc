declare module "laya-system-one" {
  type LayaQuestion = {
    type: "choice" | "score" | "noul";
    instructions: string;
    criteria?: Record<string, string | null> | string[];
    threshold?: number;
  };

  type LayaAnswer = {
    type: "choice" | "score" | "noul";
    choice?: string;
    score?: number;
    noul?: number;
    confidence?: number;
    answer_confidence?: number;
    probabilities?: Record<string, number>;
  };

  type LayaPrediction = {
    answers: Record<string, LayaAnswer>;
  };

  type LayaRuntime = {
    predict(
      state: string,
      questions: Record<string, LayaQuestion>,
    ): Promise<LayaPrediction>;
  };

  type LayaLoadOptions = {
    backend?: "wasm";
    modelDir?: string;
    wasmBase?: string;
  };

  export const Laya: {
    load(options: LayaLoadOptions): Promise<LayaRuntime>;
  };
}
