import React from "react";
import Link from "next/link";
import Image from "next/image";
import { MegaCol } from "./types";

function ImageCard({
  href,
  img,
  badge,
  title,
  meta,
}: Extract<MegaCol, { type: "imageCard" }>) {
  return (
    <Link
      href={href}
      className="news-card group relative block h-full overflow-hidden rounded-2xl border border-br-light-soft"
    >
      <div className="inner h-full">
        <div className="card-image h-full">
          <Image
            src={img}
            alt={title || "Image"}
            height={150}
            width={300}
            className="object-cover h-full w-auto transition-transform duration-300 ease-in-out group-hover:scale-[1.02]"
          />
        </div>
        {badge ? (
          <div className="bg-[#0f1021] text-white text-xs font-medium uppercase px-3 py-1.5 rounded-full absolute top-4 left-4">
            {badge}
          </div>
        ) : null}
        <div className="card-content absolute bottom-0 left-0 p-5">
          {meta ? (
            <div className="text-white text-xs"> {meta} </div>
          ) : null}
          <h5 className="mt-2 text-base font-semibold leading-snug">
            <span className="text-white">{title}</span>
          </h5>
        </div>
      </div>
    </Link>
  );
}

export default ImageCard;
