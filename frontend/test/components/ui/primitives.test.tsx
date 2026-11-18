import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('UI Primitives (Design System V1)', () => {
  describe('Button', () => {
    it('renders with children and responds to click', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      const btn = screen.getByRole('button', { name: /click me/i });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('disables the button when isLoading is true and renders spinner', () => {
      render(<Button isLoading>Submit</Button>);
      const btn = screen.getByRole('button', { name: /submit/i });
      expect(btn).toBeDisabled();
      expect(btn.querySelector('svg.animate-spin')).toBeInTheDocument();
    });

    it('applies variant and size classes correctly', () => {
      render(
        <Button variant="danger" size="sm">
          Delete
        </Button>,
      );
      const btn = screen.getByRole('button', { name: /delete/i });
      expect(btn.className).toContain('bg-danger');
      expect(btn.className).toContain('text-xs');
    });
  });

  describe('Card', () => {
    it('renders Card components hierarchy properly', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card Description</CardDescription>
          </CardHeader>
          <CardContent>
            <p>Body Content</p>
          </CardContent>
          <CardFooter>
            <span>Footer Note</span>
          </CardFooter>
        </Card>,
      );
      expect(screen.getByText('Card Title')).toBeInTheDocument();
      expect(screen.getByText('Card Description')).toBeInTheDocument();
      expect(screen.getByText('Body Content')).toBeInTheDocument();
      expect(screen.getByText('Footer Note')).toBeInTheDocument();
    });
  });

  describe('Badge', () => {
    it('renders variant and size styles', () => {
      render(
        <Badge variant="accent" size="sm">
          Active
        </Badge>,
      );
      const badge = screen.getByText('Active');
      expect(badge.className).toContain('bg-accent-soft');
      expect(badge.className).toContain('text-[11px]');
    });
  });

  describe('Input', () => {
    it('handles typing and error state', () => {
      const handleChange = jest.fn();
      render(<Input placeholder="Type here" error onChange={handleChange} />);
      const input = screen.getByPlaceholderText('Type here');
      expect(input.className).toContain('border-danger');
      fireEvent.change(input, { target: { value: 'New text' } });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('Select', () => {
    it('renders options and responds to change', () => {
      const handleChange = jest.fn();
      render(
        <Select aria-label="Layout select" onChange={handleChange} defaultValue="1">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>,
      );
      const select = screen.getByLabelText('Layout select');
      fireEvent.change(select, { target: { value: '2' } });
      expect(handleChange).toHaveBeenCalled();
      expect((select as HTMLSelectElement).value).toBe('2');
    });
  });

  describe('Switch', () => {
    it('toggles value on click', () => {
      const handleToggle = jest.fn();
      render(
        <Switch
          checked={false}
          onCheckedChange={handleToggle}
          aria-label="Toggle setting"
        />,
      );
      const toggle = screen.getByRole('switch', { name: /toggle setting/i });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      fireEvent.click(toggle);
      expect(handleToggle).toHaveBeenCalledWith(true);
    });

    it('does not toggle when disabled', () => {
      const handleToggle = jest.fn();
      render(
        <Switch
          checked={false}
          disabled
          onCheckedChange={handleToggle}
          aria-label="Disabled switch"
        />,
      );
      const toggle = screen.getByRole('switch', { name: /disabled switch/i });
      fireEvent.click(toggle);
      expect(handleToggle).not.toHaveBeenCalled();
    });
  });

  describe('Progress', () => {
    it('renders correct progress attributes and width percentage', () => {
      render(<Progress value={40} max={100} variant="accent" />);
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '40');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      const inner = bar.firstElementChild as HTMLElement;
      expect(inner.style.width).toBe('40%');
    });
  });

  describe('Tabs', () => {
    it('switches tab panels on tab trigger click', () => {
      render(
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab 1</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">Content 1</TabsContent>
          <TabsContent value="tab2">Content 2</TabsContent>
        </Tabs>,
      );

      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.queryByText('Content 2')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: /tab 2/i }));
      expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });
  });

  describe('Dialog', () => {
    it('opens on trigger click and closes on close button click', () => {
      render(
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open Modal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog Heading</DialogTitle>
              <DialogDescription>Description text</DialogDescription>
            </DialogHeader>
            <DialogClose asChild>
              <Button>Dismiss</Button>
            </DialogClose>
          </DialogContent>
        </Dialog>,
      );

      expect(screen.queryByText('Dialog Heading')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /open modal/i }));
      expect(screen.getByText('Dialog Heading')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(screen.queryByText('Dialog Heading')).not.toBeInTheDocument();
    });
  });

  describe('Drawer', () => {
    it('opens on trigger and closes on close button', () => {
      render(
        <Drawer>
          <DrawerTrigger asChild>
            <Button>Open Drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer Heading</DrawerTitle>
              <DrawerClose asChild>
                <Button>Close</Button>
              </DrawerClose>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>,
      );

      expect(screen.queryByText('Drawer Heading')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /open drawer/i }));
      expect(screen.getByText('Drawer Heading')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(screen.queryByText('Drawer Heading')).not.toBeInTheDocument();
    });
  });

  describe('EmptyState', () => {
    it('renders title, description, and action button', () => {
      render(
        <EmptyState
          title="Empty Title"
          description="Empty Description"
          action={<Button>Upload</Button>}
        />,
      );
      expect(screen.getByText('Empty Title')).toBeInTheDocument();
      expect(screen.getByText('Empty Description')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    });
  });

  describe('Skeleton', () => {
    it('renders with pulse animation class', () => {
      const { container } = render(<Skeleton className="h-6 w-24" />);
      expect(container.firstChild).toHaveClass('animate-pulse');
      expect(container.firstChild).toHaveClass('h-6');
    });
  });

  describe('ToastItem', () => {
    it('renders alert message and triggers onDismiss', () => {
      const handleDismiss = jest.fn();
      render(
        <ToastItem
          id="toast-1"
          title="Notice"
          message="Saved successfully"
          variant="success"
          onDismiss={handleDismiss}
        />,
      );
      expect(screen.getByText('Notice')).toBeInTheDocument();
      expect(screen.getByText('Saved successfully')).toBeInTheDocument();
      const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissBtn);
      expect(handleDismiss).toHaveBeenCalledWith('toast-1');
    });
  });
});
