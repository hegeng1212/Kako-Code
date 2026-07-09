import { useRef, useState } from "react";
import { IconPlus } from "./RowIcons";
import { InstallProgressButton } from "./InstallProgressButton";

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

interface SkillZipUploadProps {
  file: File | null;
  installing: boolean;
  error?: string | null;
  onFileChange: (file: File | null) => void;
  onImport: () => void;
  onError: (message: string | null) => void;
}

export function SkillZipUpload({
  file,
  installing,
  error,
  onFileChange,
  onImport,
  onError,
}: SkillZipUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(next: File | null) {
    onError(null);
    if (!next) {
      onFileChange(null);
      return;
    }
    if (!isZipFile(next)) {
      onError("请选择 .zip 格式的压缩包");
      return;
    }
    onFileChange(next);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files[0] ?? null);
  }

  return (
    <div className="skills-zip-upload">
      <div
        className={[
          "skills-zip-drop",
          dragOver && "skills-zip-drop--active",
          file && "skills-zip-drop--ready",
          error && "skills-zip-drop--error",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOver(false);
          }
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="skills-zip-drop__input"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <div className="skills-zip-drop__icon" aria-hidden="true">
          {file ? "📦" : "⬆"}
        </div>
        <div className="skills-zip-drop__text">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{(file.size / 1024).toFixed(1)} KB · 点击或拖拽可更换文件</span>
            </>
          ) : (
            <>
              <strong>拖拽 .zip 到此处</strong>
              <span>或点击选择压缩包（需包含 SKILL.md）</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="btn btn--secondary skills-zip-drop__pick"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <IconPlus className="btn__icon" />
          选择文件
        </button>
      </div>

      {error && <p className="skills-zip-upload__error">{error}</p>}

      <div className="skills-zip-upload__actions">
        {file && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={installing}
            onClick={() => {
              onFileChange(null);
              onError(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            清除
          </button>
        )}
        <InstallProgressButton
          variant="primary"
          label="导入压缩包"
          installingLabel="导入中…"
          installing={installing}
          disabled={!file}
          onClick={onImport}
        />
      </div>
    </div>
  );
}
