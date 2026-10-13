import Image from "next/image";
import Link from "next/link";
import React from "react";
import type { MegaCol } from "./types";

function ImageCard({
  href,
  img,
  badge,
  title,
  meta,
}: Extract<MegaCol, { type: "imageCard" }>) {
  return (
    <Link
      className="news-card group relative block h-full overflow-hidden rounded-2xl border border-br-light-soft"
      href={href}
    >
      <div className="inner h-full">
        <div className="card-image h-full">
          <Image
            alt={title || "Image"}
            className="h-full w-auto object-cover transition-transform duration-300 ease-in-out group-hover:scale-[1.02]"
            height={150}
            src={img}
            width={300}
          />
        </div>
        {badge ? (
          <div className="absolute top-4 left-4 rounded-full bg-[#0f1021] px-3 py-1.5 font-medium text-white text-xs uppercase">
            {badge}
          </div>
        ) : null}
        <div className="card-content absolute bottom-0 left-0 p-5">
          {meta ? <div className="text-white text-xs"> {meta} </div> : null}
          <h5 className="mt-2 font-semibold text-base leading-snug">
            <span className="text-white">{title}</span>
          </h5>
        </div>
      </div>
    </Link>
  );
}

export default ImageCard;
