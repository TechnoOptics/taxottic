// Minimal next/link stand-in for the component-test harness: a plain
// anchor. Layout is what these tests measure, and <Link> renders an <a>
// with the same box, so the substitution is layout-identical.
import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, children, ...rest }: Props) {
  // Strip the Next-only props so they never reach the DOM as attributes.
  const anchorProps: Record<string, unknown> = { ...rest };
  delete anchorProps.prefetch;
  delete anchorProps.replace;
  delete anchorProps.scroll;
  return (
    <a href={href} {...anchorProps}>
      {children}
    </a>
  );
}
