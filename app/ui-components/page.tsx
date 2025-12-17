"use client"

import Header from '@/components/Header/Header'
import { Button } from '@/components/ui/button'
import AlertError from '@/components/ui/toast/AlertError'
import AlertInfo from '@/components/ui/toast/AlertInfo'
import AlertReward from '@/components/ui/toast/AlertReward'
import AlertSuccess from '@/components/ui/toast/AlertSuccess'
import AlertWarning from '@/components/ui/toast/AlertWarning'
import { toast } from 'sonner'

const page = () => {

    const handleError = () => {
        toast.custom((id) => (
        <AlertError id={id} title='Something Went Wrong!' description='An unexpected error occurred. Please try again.' />
        ));
    }
    const handleReward = () => {
        toast.custom((id) => (
        <AlertReward id={id} title='Reward Issued!' description='Response saved and reward processed.' />
        ));
    }
    const handleWarning = () => {
        toast.custom((id) => (
        <AlertWarning id={id} title='Review Before Proceeding!' description='This needs your attention before continuing.' />
        ));
    }
    const handleSuccess = () => {
        toast.custom((id) => (
        <AlertSuccess id={id} title='Action Completed!' description='Your action was completed successfully.' />
        ));
    }
    const handleInfo = () => {
        toast.custom((id) => (
        <AlertInfo id={id} title='Some Useful Information' description='Take a moment to review this update.' />
        ));
    }
  return (
    <div>
    <Header />
        <div className='container max-w-[1200px] mx-auto py-8'>
            <h2 className='text-2xl lg:text-3xl xl:text-4xl font-semibold'>Alerts</h2>
            <div className='flex  gap-5 flex-wrap mt-4'>
                <Button onClick={handleError} variant="outline">Error Alert</Button>
                <Button onClick={handleReward} variant="outline">Reward Alert</Button>
                <Button onClick={handleWarning} variant="outline">Warning Alert</Button>
                <Button onClick={handleSuccess} variant="outline">Success Alert</Button>
                <Button onClick={handleInfo} variant="outline">Info Alert</Button>
            </div>
        </div>
    </div>
  )
}

export default page