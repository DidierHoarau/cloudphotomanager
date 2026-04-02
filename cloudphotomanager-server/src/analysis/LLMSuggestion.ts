import { Span } from "@opentelemetry/sdk-trace-base";
import axios from "axios";
import { Config } from "../Config";
import { OTelLogger, OTelTracer } from "../OTelContext";
import { FileDataListForAccount } from "../files/FileData";
import { File } from "../model/File";

const logger = OTelLogger().createModuleLogger("LLMSuggestion");

export async function LLMSuggestionGetForAccount(
  context: Span,
  config: Config,
  accountId: string
): Promise<{ suggestion: string; files: { filepath: string; filename: string; hash: string; size: number }[] }> {
  const span = OTelTracer().startSpan("LLMSuggestionGetForAccount", context);
  const files: File[] = await FileDataListForAccount(span, accountId);

  // Map files to required info
  const fileList = files.map((file) => ({
    filepath: file.folderId + "/" + file.filename,
    filename: file.filename,
    hash: file.hash,
    size: file.info?.size || 0,
  }));

  let suggestion = "";
  try {
    const response = await axios.post(
      config.LLM_API_URL,
      {
        model: config.LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a file organization assistant. Suggest how to organize the following files. Group by type, project, or other logical structure. Use markdown headings and lists. Be concise and practical.",
          },
          {
            role: "user",
            content:
              "Here is the list of files (with path, hash, size):\n" +
              fileList
                .map(
                  (f) =>
                    `- ${f.filepath} (hash: ${f.hash}, size: ${f.size})`
                )
                .join("\n"),
          },
        ],
      },
      { timeout: 60000 }
    );
    suggestion = response.data.choices?.[0]?.message?.content || "";
  } catch (e) {
    logger.error("LLM suggestion failed", e);
    suggestion = "Failed to get LLM suggestion.";
  }
  span.end();
  return { suggestion, files: fileList };
}
