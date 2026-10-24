import { pipeline } from "@huggingface/transformers";
import { StandardTracer } from "@devopsplaybook.io/otel-utils";
import { Config } from "../Config";
import { OTelSetTracer } from "../OTelContext";
import {
  AnalysisImagesGetLabels,
  AnalysisImagesInit,
} from "./AnalysisImages";

jest.mock("@huggingface/transformers", () => ({
  pipeline: jest.fn(),
}));
const mockedPipeline = pipeline as jest.Mock;

function buildConfig(fields: {
  IMAGE_CLASSIFICATION_ENABLED: boolean;
  IMAGE_CLASSIFICATION_MODEL: string;
}): Config {
  return {
    IMAGE_CLASSIFICATION_ENABLED: fields.IMAGE_CLASSIFICATION_ENABLED,
    IMAGE_CLASSIFICATION_MODEL: fields.IMAGE_CLASSIFICATION_MODEL,
    VERSION: "0.0.0",
  } as unknown as Config;
}

describe("AnalysisImagesGetLabels", () => {
  beforeAll(() => {
    OTelSetTracer(
      new StandardTracer({
        SERVICE_ID: "cloudphotomanager-server-test",
        VERSION: "0.0.0",
      }),
    );
  });

  beforeEach(() => {
    mockedPipeline.mockReset();
  });

  // Runs first on purpose: the module-level pipeline cache persists for the
  // whole file, and the disabled case must prove no pipeline is ever created.
  it("returns no labels and never loads the model when classification is disabled", async () => {
    await AnalysisImagesInit(
      undefined as any,
      buildConfig({
        IMAGE_CLASSIFICATION_ENABLED: false,
        IMAGE_CLASSIFICATION_MODEL: "Xenova/efficientnet-b0",
      }),
    );

    const labels = await AnalysisImagesGetLabels(
      undefined as any,
      "/tmp/photo.jpg",
    );

    expect(labels).toEqual([]);
    expect(mockedPipeline).not.toHaveBeenCalled();
  });

  it("loads the configured model and returns its labels when enabled", async () => {
    const fakePipe = jest.fn().mockResolvedValue([
      { label: "dog", score: 0.9 },
      { label: "animal", score: 0.7 },
      { label: "grass", score: 0.4 },
    ]);
    mockedPipeline.mockResolvedValue(fakePipe);
    await AnalysisImagesInit(
      undefined as any,
      buildConfig({
        IMAGE_CLASSIFICATION_ENABLED: true,
        IMAGE_CLASSIFICATION_MODEL: "Xenova/efficientnet-b0",
      }),
    );

    const labels = await AnalysisImagesGetLabels(
      undefined as any,
      "/tmp/photo.jpg",
    );

    expect(mockedPipeline).toHaveBeenCalledTimes(1);
    expect(mockedPipeline).toHaveBeenCalledWith(
      "image-classification",
      "Xenova/efficientnet-b0",
    );
    expect(fakePipe).toHaveBeenCalledWith("/tmp/photo.jpg", { top_k: 5 });
    expect(labels).toEqual([
      { label: "dog", score: 0.9 },
      { label: "animal", score: 0.7 },
      { label: "grass", score: 0.4 },
    ]);
  });
});
