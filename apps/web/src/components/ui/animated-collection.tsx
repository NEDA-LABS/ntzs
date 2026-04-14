"use client";

import React, { useState } from "react";
import { motion, LayoutGroup, AnimatePresence, type Transition } from "motion/react";
import { cn } from "@/lib/utils";
import { List, LayoutGrid, Layers, Star } from "lucide-react";

interface CollectionItem {
  id: string;
  title: string;
  subtitle: string;
  idNumber: string;
  image: string; // square image from public
  iconSrc: string; // small icon from public
}

// Using our public assets
const ITEMS: CollectionItem[] = [
  {
    id: "1",
    title: "nTZS",
    subtitle: "Stable TZS",
    idNumber: "TZS",
    image: "/ntzs-logo.png",
    iconSrc: "/ntzs-icon.svg",
  },
  {
    id: "2",
    title: "USDC",
    subtitle: "USD Coin",
    idNumber: "USD",
    image: "/usdc.png",
    iconSrc: "/usdc-logo.svg",
  },
];

type ViewMode = "list" | "card" | "pack";

const snappySpring: Transition = {
  type: "spring",
  stiffness: 350,
  damping: 30,
  mass: 1,
};

const fastFade: Transition = {
  duration: 0.1,
  ease: "linear",
};

export function LayoutSwitcher() {
  const [view, setView] = useState<ViewMode>("list");
  return (
    <div className="w-full max-w-xl mx-auto p-4 md:p-8 font-sans selection:bg-primary/10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-5">
          <h2 className="text-xl font-medium text-foreground ">My Collection</h2>

          <div className="flex p-1 bg-muted rounded-full w-fit border border-border">
            <Tab active={view === "list"} onClick={() => setView("list")} icon={<List size={16} />} label="List view" />
            <Tab active={view === "card"} onClick={() => setView("card")} icon={<LayoutGrid size={16} />} label="Card view" />
            <Tab active={view === "pack"} onClick={() => setView("pack")} icon={<Layers size={16} />} label="Pack view" />
          </div>
        </div>
        <div className="h-px bg-border w-full" />
        {/* Content Section */}
        <div className="relative min-h-[350px] flex flex-col items-center">
          <LayoutGroup>
            <motion.div
              layout
              transition={snappySpring}
              className={cn(
                "w-full relative",
                view === "list" && "flex flex-col gap-4",
                view === "card" && "grid grid-cols-2 gap-4",
                view === "pack" && "h-64 flex items-center justify-center mt-8"
              )}
            >
              {ITEMS.map((item, index) => (
                <motion.div
                  key={item.id}
                  layout
                  transition={snappySpring}
                  className={cn(
                    "relative flex items-center z-10",
                    view === "list" && "flex-row gap-4 w-full",
                    view === "card" && "flex-col gap-3 w-full items-start",
                    view === "pack" && "absolute w-56 h-56 items-center justify-center"
                  )}
                  style={{ zIndex: view === "pack" ? ITEMS.length - index : 1 }}
                  animate={
                    view === "pack"
                      ? {
                          rotate: index === 0 ? -12 : 6,
                          x: index === 0 ? -25 : 25,
                          y: index === 0 ? -5 : 5,
                        }
                      : { rotate: 0, x: 0, y: 0 }
                  }
                >
                  <motion.div
                    layout
                    transition={snappySpring}
                    className={cn(
                      "relative overflow-hidden shrink-0 bg-background",
                      view === "list" && "w-16 h-16 rounded-2xl border border-border/50 ",
                      view === "card" && "w-full aspect-square rounded-[1.8rem] border border-border/50 shadow-sm",
                      view === "pack" && "w-full h-full rounded-[2rem] border border-border/50  shadow-xl"
                    )}
                  >
                    <motion.img
                      layout
                      transition={snappySpring}
                      src={item.image}
                      alt={item.title}
                      className={cn(
                        "w-full h-full object-cover m-0! p-0! block",
                        view === "list" && "rounded-2xl",
                        view === "card" && "rounded-[1.8rem]",
                        view === "pack" && "rounded-[2rem]"
                      )}
                    />
                  </motion.div>

                  <AnimatePresence mode="popLayout" initial={false}>
                    {view !== "pack" && (
                      <motion.div
                        key={`${item.id}-info`}
                        layout
                        initial={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.9, filter: "blur(4px)" }}
                        transition={fastFade}
                        className={cn(
                          "flex flex-1 justify-between items-center min-w-0",
                          view === "card" ? "w-full px-1" : "px-0"
                        )}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <motion.h3 layout className="font-medium text-[15px] text-foreground leading-tight truncate">
                            {item.title}
                          </motion.h3>
                          <motion.div layout className="text-muted-foreground font-medium text-xs flex items-center gap-1.5">
                            <img src={item.iconSrc} alt="icon" className="h-3.5 w-3.5" />
                            <span className="truncate">{item.subtitle}</span>
                          </motion.div>
                        </div>

                        <motion.div layout className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/5 text-primary text-[10px] font-bold shrink-0 ml-2">
                          <Star size={10} className="text-yellow-500 fill-yellow-500" />
                          <span>#{item.idNumber}</span>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {view === "list" && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="absolute -bottom-2 left-18 right-0 h-px bg-border/40"
                    />
                  )}
                </motion.div>
              ))}
            </motion.div>

            <AnimatePresence>
              {view === "pack" && (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: 5, filter: "blur(5px)" }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className="mt-16 text-center space-y-3 px-4 relative z-0"
                >
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wide">
                    <span className="i-lucide-ticket size-3" />
                    <span>Bundle unlocked</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </LayoutGroup>
        </div>
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-4 py-2 text-sm font-normal  uppercase transition-all rounded-full outline-none",
        active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {active && (
        <motion.div layoutId="active-tab" className="absolute inset-0 bg-primary rounded-full shadow-md" transition={snappySpring} />
      )}
      <span className="relative z-10 flex items-center gap-2">{icon}{label}</span>
    </button>
  );
}

export default LayoutSwitcher;
