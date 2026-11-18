'use client';

import * as React from 'react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Input,
  Select,
  Switch,
  Progress,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
  EmptyState,
  Skeleton,
  ToastItem,
} from '@/components/ui';

export default function UiDevShowcasePage() {
  const [switchChecked, setSwitchChecked] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [progressVal, setProgressVal] = React.useState(45);
  const [toastVisible, setToastVisible] = React.useState(true);

  return (
    <div className="min-h-screen bg-bg text-text p-6 sm:p-10 max-w-5xl mx-auto space-y-10">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text">
          ReelCast UI Primitives Showcase
        </h1>
        <p className="text-muted mt-2 text-sm sm:text-base">
          Target V1 Design System components strictly based on tokens in{' '}
          <code className="text-accent bg-surface-2 px-1.5 py-0.5 rounded text-xs">
            app/globals.css
          </code>
          .
        </p>
      </div>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" isLoading>
            Loading
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Badges</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="accent">Ready (Accent)</Badge>
          <Badge variant="warning">Processing (Warning)</Badge>
          <Badge variant="danger">Failed (Danger)</Badge>
          <Badge variant="info">Transcribing (Info)</Badge>
          <Badge variant="muted">Draft</Badge>
          <Badge variant="accent" size="sm">
            Small Badge
          </Badge>
        </div>
      </section>

      {/* Form Controls */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Form Controls</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Input Field</label>
            <Input placeholder="Enter title..." defaultValue="Episode #42" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Select Dropdown</label>
            <Select defaultValue="podcast">
              <option value="podcast">Podcast (2 People)</option>
              <option value="solo">Solo (1 Person)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">Switch Toggle</label>
            <div className="pt-2 flex items-center gap-3">
              <Switch
                checked={switchChecked}
                onCheckedChange={setSwitchChecked}
                aria-label="Toggle auto-clips"
              />
              <span className="text-sm text-text">
                {switchChecked ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Progress */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Progress Bars</h2>
        <div className="space-y-3 max-w-xl">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Rendering Clip (45%)</span>
            <button
              onClick={() => setProgressVal((p) => (p >= 100 ? 0 : p + 25))}
              className="text-accent hover:underline"
            >
              Step +25%
            </button>
          </div>
          <Progress value={progressVal} variant="accent" />
          <Progress value={75} variant="info" size="sm" />
          <Progress value={20} variant="danger" size="lg" />
        </div>
      </section>

      {/* Card */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Cards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>AI Topic Segmentation</CardTitle>
              <CardDescription>
                Automatically extracts viral clips based on topic shifts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">
                Analyzed 45 minutes of audio and identified 6 cohesive reel clips.
              </p>
            </CardContent>
            <CardFooter>
              <span className="text-xs text-muted">6 clips generated</span>
              <Button size="sm" variant="secondary">
                Review
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Solo Reframe Mode</CardTitle>
              <CardDescription>
                Continuous face centering with stable bounding box.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">
                Frame cropped to 9:16 vertical ratio without shaky movement.
              </p>
            </CardContent>
            <CardFooter>
              <Badge variant="accent">Ready</Badge>
              <Button size="sm" variant="primary">
                Export
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      {/* Tabs */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Tabs</h2>
        <div className="max-w-xl">
          <Tabs defaultValue="clips">
            <TabsList>
              <TabsTrigger value="clips">Clips (8)</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="clips">
              <div className="p-4 bg-surface rounded-xl border border-border text-sm text-muted">
                Clips tab content is displayed here in the 9:16 grid.
              </div>
            </TabsContent>
            <TabsContent value="transcript">
              <div className="p-4 bg-surface rounded-xl border border-border text-sm text-muted">
                Transcript lines with word timestamps and speaker labels.
              </div>
            </TabsContent>
            <TabsContent value="settings">
              <div className="p-4 bg-surface rounded-xl border border-border text-sm text-muted">
                Video and reframe preferences.
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* Dialog & Drawer */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Overlays (Dialog & Drawer)</h2>
        <div className="flex gap-4">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">Open Modal Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Export All Clips</DialogTitle>
                <DialogDescription>
                  This will queue render jobs for all 8 draft clips with subtitle burn-in.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2 text-sm text-muted">
                Estimated processing time: 2 minutes.
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>
                  Start Export
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerTrigger asChild>
              <Button variant="secondary">Open Clip Editor Drawer</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Edit Clip #1</DrawerTitle>
                <DrawerClose asChild>
                  <Button variant="ghost" size="sm">
                    ✕
                  </Button>
                </DrawerClose>
              </DrawerHeader>
              <div className="p-5 space-y-4 flex-1">
                <p className="text-sm text-muted">
                  Trim boundaries, subtitle styling presets, and reframing layout.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted">Clip Title</label>
                  <Input defaultValue="Why AI is changing content creation" />
                </div>
              </div>
              <div className="p-5 border-t border-border flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setDrawerOpen(false)}>
                  Save Changes
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </section>

      {/* Empty State */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Empty State</h2>
        <div className="max-w-xl">
          <EmptyState
            title="No videos uploaded yet"
            description="Upload your first podcast or interview video to generate viral 9:16 reels."
            action={<Button variant="primary">Upload Video</Button>}
          />
        </div>
      </section>

      {/* Skeletons */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Skeletons</h2>
        <div className="space-y-2 max-w-md">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </section>

      {/* Toast */}
      {toastVisible && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-text">Toast Notification</h2>
          <div className="max-w-sm">
            <ToastItem
              id="sample-toast"
              title="Upload Completed"
              message="Video uploaded successfully and queued for ingestion."
              variant="success"
              onDismiss={() => setToastVisible(false)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
