import { create } from "zustand";

type StateType = {
  isSubscriptionDialogOpen: boolean;
  setIsSubscriptionDialogOpen: (isSubscriptionDialogOpen: boolean) => void;
};

const useAppStore = create<StateType>()((set) => ({
  isSubscriptionDialogOpen: false,
  setIsSubscriptionDialogOpen: (isSubscriptionDialogOpen: boolean) =>
    set({ isSubscriptionDialogOpen }),
}));

export default useAppStore;
