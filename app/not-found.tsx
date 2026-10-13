import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const notfound = () => {
  return (
    <div className="mx-auto max-w-[1082px] px-5 py-10">
      <h1 className="text-center font-semibold text-2xl text-content-dark md:text-3xl lg:text-4xl">
        Page Not Found
      </h1>
      <div className="mt-4 flex justify-center">
        <Link href="/">
          <Button className="px-8">Go Home</Button>
        </Link>
      </div>
      <div>
        <Image
          alt="Not Found"
          className="dark:hidden"
          height={553}
          src="/images/bg/not-found-light.png"
          width={1082}
        />
        <Image
          alt="Not Found"
          className="hidden dark:block"
          height={553}
          src="/images/bg/not-found-dark.png"
          width={1082}
        />
      </div>
    </div>
  );
};

export default notfound;
