import { type ComponentProps, memo } from "react";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationSource,
} from "./elements/inline-citation";

export type CitationSource = {
  position: number;
  title: string;
  url: string;
  description: string;
  date?: string;
};

type CitationResponseProps = ComponentProps<typeof InlineCitation> & {
  sources?: CitationSource[];
};

export const CitationResponse = memo(
  ({ children, sources, ...props }: CitationResponseProps) => {
    if (!sources || sources.length === 0) return null;

    return (
      <InlineCitation {...props}>
        <InlineCitationCard>
          <a
            className="[&_h4]:hover:underline"
            href={sources[0].url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <InlineCitationCardTrigger sources={sources.map((s) => s.url)} />
          </a>
          <InlineCitationCardBody>
            {sources.length > 1 ? (
              <InlineCitationCarousel>
                <InlineCitationCarouselHeader>
                  <InlineCitationCarouselPrev />
                  <InlineCitationCarouselNext />
                  <InlineCitationCarouselIndex />
                </InlineCitationCarouselHeader>
                <InlineCitationCarouselContent>
                  {sources.map((source) => (
                    <InlineCitationCarouselItem key={source.position}>
                      <a
                        className="[&_h4]:hover:underline"
                        href={source.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <InlineCitationSource
                          description={source.description}
                          title={source.title}
                          url={source.url}
                        >
                          {source.date ? (
                            <span className="text-muted-foreground text-xs">
                              {source.date}
                            </span>
                          ) : null}
                        </InlineCitationSource>
                      </a>
                    </InlineCitationCarouselItem>
                  ))}
                </InlineCitationCarouselContent>
              </InlineCitationCarousel>
            ) : (
              <div className="p-4">
                <a
                  className="[&_h4]:hover:underline"
                  href={sources[0].url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <InlineCitationSource
                    description={sources[0].description}
                    title={sources[0].title}
                    url={sources[0].url}
                  >
                    {sources[0].date ? (
                      <span className="text-muted-foreground text-xs">
                        {sources[0].date}
                      </span>
                    ) : null}
                  </InlineCitationSource>
                </a>
              </div>
            )}
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    );
  }
);

CitationResponse.displayName = "CitationResponse";
