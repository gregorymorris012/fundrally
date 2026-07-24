import Image from "next/image";

export function Logo({ size = 96 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="FundRally"
      width={size}
      height={size}
      priority
    />
  );
}
