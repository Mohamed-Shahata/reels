'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { AppHeader } from '@/components/layout/app-header';
import { useLanguage } from '@/lib/i18n/language-context';
import { useVideo } from '@/lib/hooks/use-video';
import { useClipEditor } from '@/lib/hooks/use-clip-editor';
import { PipelineStepper } from '@/components/videos/pipeline-stepper';
import { ClipsGrid } from '@/components/videos/clips-grid';
import { TranscriptPanel } from '@/components/videos/transcript-panel';
import { ClipEditorDrawer } from '@/components/videos/clip-editor-drawer';
import { ExportDialog } from '@/components/videos/export-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FilmIcon,
  FileTextIcon,
} from '@/components/ui/icons';
import type { Clip } from '@/lib/api';

export default function VideoWorkspacePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isRtl, t } = useLanguage();
  const { status } = useAuth();

  const videoId = typeof params?.id === 'string' ? params.id : '';
  const initialTab = searchParams.get('tab') === 'transcript' ? 'transcript' : 'clips';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [exportClip, setExportClip] = useState<Clip | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);

  const {
    video,
    clips,
    transcript,
    playbackUrl,
    reframePlan,
    isLoading,
    isRetryingStage,
    isGeneratingClips,
    generateAiClips,
    retryStage,
    deleteClip,
    renameClip,
    setClips,
  } = useVideo(videoId);

  const editor = useClipEditor();

  if (status === 'unauthenticated') {
    router.replace('/login');
    return null;
  }

  const handleOpenExport = (clip: Clip) => {
    setExportClip(clip);
    setIsExportDialogOpen(true);
  };

  const handleConfirmExport = async () => {
    setIsExportDialogOpen(false);
  };

  const handleExportAll = async () => {
    setIsExportingAll(true);
    try {
      // batch export
    } finally {
      setIsExportingAll(false);
    }
  };

  const handleSaveClip = async (updated: Clip) => {
    setClips((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    editor.closeEditor();
  };

  const BackArrow = isRtl ? ArrowRightIcon : ArrowLeftIcon;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top Video Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg border border-border bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t('workspace.backToLibrary')}
            >
              <BackArrow className="w-4 h-4" />
            </Link>

            <div>
              {isLoading ? (
                <Skeleton className="h-7 w-48" />
              ) : (
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {video?.title || 'Video Project'}
                  </h1>
                  {video?.status && (
                    <Badge
                      variant={
                        video.status === 'READY'
                          ? 'accent'
                          : video.status === 'FAILED'
                            ? 'danger'
                            : 'muted'
                      }
                      className="text-xs"
                    >
                      {video.status}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline Stepper */}
        <PipelineStepper
          stages={video?.pipeline ?? []}
          videoStatus={video?.status ?? 'READY'}
          onRetryStage={retryStage}
          isRetryingStage={isRetryingStage}
        />

        {/* Tabs: Clips & Transcript */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full space-y-6"
        >
          <TabsList className="bg-card border border-border p-1">
            <TabsTrigger
              value="clips"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium"
            >
              <FilmIcon className="w-4 h-4" />
              <span>
                {t('workspace.clipsTab', { count: clips.length })}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="transcript"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium"
            >
              <FileTextIcon className="w-4 h-4" />
              <span>{t('workspace.transcriptTab')}</span>
            </TabsTrigger>
          </TabsList>

          {/* Clips Tab Content */}
          <TabsContent value="clips" className="focus-visible:outline-none">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-64 rounded-2xl" />
                ))}
              </div>
            ) : (
              <ClipsGrid
                clips={clips}
                activeClipId={editor.activeClip?.id}
                onPreviewClip={(clip) => editor.openEditor(clip)}
                onEditClip={(clip) => editor.openEditor(clip)}
                onExportClip={handleOpenExport}
                onDeleteClip={(clip) => void deleteClip(clip.id)}
                onRenameClip={async (clip, newTitle) => {
                  await renameClip(clip.id, newTitle);
                  return true;
                }}
                onExportAll={handleExportAll}
                isExportingAll={isExportingAll}
                onGenerateAiClips={generateAiClips}
                isGeneratingClips={isGeneratingClips}
              />
            )}
          </TabsContent>

          {/* Transcript Tab Content */}
          <TabsContent value="transcript" className="focus-visible:outline-none">
            <TranscriptPanel
              videoId={videoId}
              transcript={transcript}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Slide-over Clip Editor Drawer */}
      <ClipEditorDrawer
        isOpen={editor.isOpen}
        onClose={editor.closeEditor}
        clip={editor.activeClip}
        videoPlaybackUrl={playbackUrl}
        reframePlan={reframePlan}
        contentType={video?.contentType}
        transcriptSegments={transcript?.segments}
        onSave={handleSaveClip}
        onExport={handleOpenExport}
      />

      {/* Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        clip={exportClip}
        onConfirmExport={handleConfirmExport}
      />
    </div>
  );
}
