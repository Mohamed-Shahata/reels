'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { PipelineStage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  CheckIcon,
  LoaderIcon,
  AlertCircleIcon,
  RefreshIcon,
} from '@/components/ui/icons';

interface PipelineStepperProps {
  stages: PipelineStage[];
  videoStatus: string;
  onRetryStage?: (stage: PipelineStage) => void;
  isRetryingStage?: string | null;
}

interface StepDef {
  key: string;
  labelKey: string;
  stageName?: 'INGEST' | 'TRANSCRIBE' | 'SEGMENT' | 'ANALYZE';
}

const STEPS: StepDef[] = [
  { key: 'UPLOAD', labelKey: 'pipeline.upload' },
  { key: 'INGEST', labelKey: 'pipeline.ingest', stageName: 'INGEST' },
  { key: 'TRANSCRIBE', labelKey: 'pipeline.transcribe', stageName: 'TRANSCRIBE' },
  { key: 'SEGMENT', labelKey: 'pipeline.segment', stageName: 'SEGMENT' },
  { key: 'ANALYZE', labelKey: 'pipeline.analyze', stageName: 'ANALYZE' },
];

export function PipelineStepper({
  stages,
  videoStatus,
  onRetryStage,
  isRetryingStage,
}: PipelineStepperProps) {
  const { t } = useLanguage();

  const getStageStatus = (def: StepDef) => {
    if (def.key === 'UPLOAD') {
      return { status: 'COMPLETED', progress: 100, errorCode: null, jobId: null };
    }
    const found = stages.find((s) => s.stage === def.stageName);
    if (!found) {
      if (videoStatus === 'READY') {
        return { status: 'COMPLETED', progress: 100, errorCode: null, jobId: null };
      }
      return { status: 'PENDING', progress: 0, errorCode: null, jobId: null };
    }
    return found;
  };

  const failedStage = stages.find((s) => s.status === 'FAILED');

  return (
    <div className="w-full rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-4">
      {/* Horizontal Steps Bar */}
      <div className="flex items-center justify-between relative overflow-x-auto pb-1">
        {STEPS.map((step, index) => {
          const stageData = getStageStatus(step);
          const isCompleted =
            stageData.status === 'COMPLETED' ||
            stageData.status === 'READY' ||
            videoStatus === 'READY';
          const isFailed = stageData.status === 'FAILED';
          const isRunning =
            stageData.status === 'RUNNING' || stageData.status === 'RETRYING';

          return (
            <React.Fragment key={step.key}>
              {index > 0 && (
                <div
                  className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${
                    isCompleted ? 'bg-primary' : 'bg-muted'
                  }`}
                  aria-hidden="true"
                />
              )}
              <div className="flex flex-col items-center min-w-[70px] text-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200 ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : isFailed
                        ? 'bg-destructive text-destructive-foreground'
                        : isRunning
                          ? 'border-2 border-primary bg-primary/10 text-primary animate-pulse'
                          : 'border border-border bg-muted/40 text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <CheckIcon className="w-4 h-4" />
                  ) : isFailed ? (
                    <AlertCircleIcon className="w-4 h-4" />
                  ) : isRunning ? (
                    <LoaderIcon className="w-4 h-4" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <span
                  className={`text-xs mt-2 font-medium truncate max-w-[90px] ${
                    isFailed
                      ? 'text-destructive font-semibold'
                      : isRunning
                        ? 'text-primary font-semibold'
                        : isCompleted
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                  }`}
                >
                  {t(step.labelKey)}
                </span>
                {isRunning && stageData.progress > 0 && (
                  <span className="text-[10px] text-primary mt-0.5">
                    {Math.round(stageData.progress)}%
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Failed Stage Callout with Retry */}
      {failedStage && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircleIcon className="w-4 h-4 shrink-0" />
            <span>
              {failedStage.errorCode
                ? t(`errors.${failedStage.errorCode}`) !== `errors.${failedStage.errorCode}`
                  ? t(`errors.${failedStage.errorCode}`)
                  : t('pipeline.stageError', { error: failedStage.errorCode })
                : t('pipeline.failed')}
            </span>
          </div>
          {onRetryStage && (
            <Button
              variant="outline"
              size="sm"
              disabled={isRetryingStage === failedStage.stage}
              onClick={() => onRetryStage(failedStage)}
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              {isRetryingStage === failedStage.stage ? (
                <>
                  <LoaderIcon className="w-3.5 h-3.5 me-1.5" />
                  {t('pipeline.retrying')}
                </>
              ) : (
                <>
                  <RefreshIcon className="w-3.5 h-3.5 me-1.5" />
                  {t('pipeline.retry')}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
